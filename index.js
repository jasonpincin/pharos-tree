var through2     = require('through2'),
    validPath    = require('./lib/valid-path'),
    parents      = require('./lib/parents'),
    error        = require('./lib/error'),
    setImmediate = setImmediate || process.nextTick

module.exports = function pharosTree () {
    var data        = Object.create(null),
        txid        = 0,
        numStreams  = 0,
        changes     = through2.obj()

    // increment ptree transaction id
    function incTransaction () {
        txid++
        return txid
    }

    // create stream of changes
    function createStream (options) {
        options = options || {}

        var stream = through2.obj(function transform (chunk, encoding, cb) {
            stream.push(options.objectMode ? chunk : JSON.stringify(chunk)+'\n')
            cb()
        })
        stream.close = function close () {
            setImmediate(function () {
                stream.push(null)
                changes.unpipe(stream)
            })
            numStreams--
        }
        changes.pipe(stream)
        numStreams++
        return stream
    }
    // feed change streams
    function feed(op, pnode) {
        if (numStreams > 0) {
            changes.push({op:op, pnode:pnode.toJSON()})
        }
    }

    // pnode factory
    function createPnode (path) {
        var pnode = new TreePnode
        pnode.path = path
        pnode._children = []
        return pnode
    }
    // persist pnode
    function persistPnode (pnode, validated) {
        if (pnode.exists) return pnode
        if (!validated && !validPath(pnode.path)) throw error('INVALIDPATH', 'invalid path: ' + pnode.path)
        Object.defineProperty(pnode, 'path', {enumerable:true, configurable: false, writable: false, value:pnode.path})
        data[pnode.path] = pnode
        if (pnode.parent) {
            persistPnode(pnode.parent, true)
            addChild(pnode.parent, pnode)
        }
        incTransaction()
        incPnodeVersion(pnode)
        feed('create', pnode)
        return pnode
    }
    // remove pnode
    function removePnode (pnode, skipParent) {
        if (!pnode.exists) return pnode
        for (var i = 0; i < pnode.children.length; i++) removePnode(pnode.children[i], true)
        if (!skipParent) {
            removeChild(pnode.parent, pnode)
        }
        delete data[pnode.path]
        incTransaction()
        feed('remove', pnode)
        return pnode
    }
    // set pnode data
    function setPnodeData (pnode, value) {
        if (!pnode.exists) {
            pnode._data = value
            persistPnode(pnode)
        }
        else if (pnode._data !== value) {
            pnode._data = value
            incTransaction()
            incPnodeVersion(pnode)
            feed('change', pnode)
        }
        return pnode
    }
    // unset pnode data
    function unsetPnodeData (pnode) {
        if (pnode.hasOwnProperty('_data') && pnode._data !== undefined) {
            pnode._data = undefined
            incTransaction()
            incPnodeVersion(pnode)
            feed('change', pnode)
        }
        return pnode
    }
    // increment pnode version
    function incPnodeVersion (pnode) {
        pnode._version = pnode._version ? pnode._version + 1 : 1
        pnode._mtxid = ptree.txid
        pnode._mtime = new Date
        if (!pnode._ctxid) pnode._ctxid = pnode._mtxid
        if (!pnode._ctime) pnode._ctime = pnode._mtime
        return pnode
    }
    // incrememnt childrenVersion of pnode
    function incChildrenVersion (pnode) {
        if (pnode && pnode._childrenVersion) pnode._childrenVersion++
        else pnode._childrenVersion = 1
        return pnode
    }
    // pnode children
    function pnodeChildren (pnode) {
        var list = []
        for (var i = 0; i < pnode._children.length; i++) list[i] = pnode._children[i]
        return list
    }
    // add child to pnode
    function addChild(parent, child) {
        parent._children.push(child)
        incChildrenVersion(parent)
        return parent
    }
    // remove child from pnode
    function removeChild(parent, child) {
        var parentChildIdx = parent._children.indexOf(child)
        parent._children.splice(parentChildIdx, 1)
        incChildrenVersion(parent)
        return parent
    }
    // get all parents of a pnoce
    function pnodeParents (pnode) {
        if (!pnode.valid) return undefined
        var parentPaths = parents(pnode.path),
        list            = []
        for (var i = 0; i < parentPaths.length; i++) list.push( ptree(parentPaths[i]) )
        return list
    }
    // get immediate parent of pnode
    function pnodeParent (pnode) {
        if (!pnode.valid) return undefined
        var parentPath = parents.immediate(pnode.path)
        return parentPath ? ptree(parentPath) : null
    }
    // ptree pnode prototype
    function TreePnode () {}
    TreePnode.prototype = Object.create(Object, {
        // properties
        path           : { enumerable:true, configurable:true, writable:true, value:undefined },
        name           : { enumerable: true, get: function () { return this.path === '/' ? '/' : this.path.split('/').pop() } },
        exists         : { enumerable:true,  get: function () { return data[this.path] ? true : false } },
        valid          : { enumerable:true,  get: function () { return this.exists ? true : validPath(this.path) } },
        data           : { enumerable: true, get: function () { return this._data }, set: function (value) { setPnodeData(this, value) } },
        version        : { enumerable: true, get: function () { return this._version } },
        ctxid          : { enumerable: true, get: function () { return this._ctxid } },
        mtxid          : { enumerable: true, get: function () { return this._mtxid } },
        ctime          : { enumerable: true, get: function () { return this._ctime } },
        mtime          : { enumerable: true, get: function () { return this._mtime } },
        parents        : { enumerable: true, get: function () { return pnodeParents(this) } },
        parent         : { enumerable: true, get: function () { return pnodeParent(this) } },
        children       : { enumerable: true, get: function () { return pnodeChildren(this) } },
        childrenVersion: { enumerable: true, get: function () { return this._childrenVersion } },
        // functions
        set            : { value: function (value) { return setPnodeData(this, value) } },
        unset          : { value: function ()      { return unsetPnodeData(this) } },
        remove         : { value: function ()      { return removePnode(this) } },
        child          : { value: function (name)  { return ptree(this.path + '/' + name) } },
        persist        : { value: function ()      { return persistPnode(this) } },
        // JSON representation
        toJSON: { value: function () {
            return {
                path    : this.path,
                data    : this._data,
                version : this.version,
                ctime   : this.ctime,
                mtime   : this.mtime,
                ctxid   : this.ctxid,
                mtxid   : this.mtxid
            }
        } }
    })

    // ptree entry point / selector
    function ptree (path) {
        return data[path] || createPnode(path)
    }
    Object.defineProperties(ptree, {
        // properties
        txid        : { enumerable: true, get: function () { return txid } },
        pnodeCount  : { enumerable: true, get: function () { return Object.keys(data).length } },
        // functions
        createStream: { value: createStream },
        // pnode prototype
        pnode       : { value: TreePnode.prototype }
    })

    // initialize root pnode
    var rootPnode = createPnode('/').persist()
    Object.defineProperties(rootPnode, {
        remove: { value: function () {
            throw new Error('Can not remove root pnode.')
        } },
        parent: { enumerable: true, value: null }
    })

    return ptree
}
