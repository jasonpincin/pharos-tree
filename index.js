var through2  = require('through2'),
    validPath = require('./lib/valid-path'),
    parents   = require('./lib/parents'),
    error     = require('./lib/error')

module.exports = function createTree () {
    'use strict';
    var data       = Object.create(null),
        numStreams = 0,
        changes    = through2.obj()

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
    function feed(op, node) {
        if (numStreams > 0) {
            changes.push({op:op, node:node})
        }
    }

    // tree node factory
    function createNode (path) {
        var node = new TreeNode
        node.path = path
        return node
    }
    // tree node persist
    function persistNode (node, validated) {
        if (node.exists) return node
        if (!validated && !validPath(node.path)) throw error('INVALIDPATH', 'invalid path: ' + node.path)
        Object.defineProperty(node, 'path', {enumerable:true, configurable: false, writable: false, value:node.path})
        data[node.path] = node
        if (node.parent) persistNode(node.parent, true)
        feed('create', node)
        return node
    }
    // tree node prototype
    function TreeNode () {}
    TreeNode.prototype = Object.create(Object, {
        // properties
        path: { enumerable:true, configurable:true, writable:true, value:undefined },
        exists: { enumerable:true, get: function () {
            return data[this.path] ? true : false
        } },
        valid: { enumerable:true, get: function () {
            return this.exists ? true : validPath(this.path)
        } },
        data: { enumerable: true, set: function (value) {
            if (!this.exists) {
                this._data = value
                persistNode(this)
            }
            else if (this._data !== value) {
                this._data = value
                feed('change', this)
            }
        }, get: function () {
            return this._data
        } },
        parent: { enumerable: true, get: function () {
            if (!this.valid) return undefined
            var ppath = parents.immediate(this.path)
            return ppath ? tree(ppath) : null
        } },
        children: { enumerable: true, get: function () {
        } },
        // functions
        persist: { value: function () {
            return persistNode(this)
        } },
        set: { value: function (value) {
            this.data = value
            return this
        } },
        unset: { value: function () {
            if (this.hasOwnProperty('_data')) {
                delete this._data
                feed('change', this)
            }
            return this
        } },
        remove: { value: function () {
            if (this.exists) {
                delete data[this.path]
                feed('remove', this)
            }
            return this
        } },
        child: { value: function () {
        } },
        addChild: { value: function () {
        } },
        removeChild: { value: function () {
        } },
        toJSON: { value: function () {
            return {
                path: this.path,
                data: this._data
            }
        } }
    })

    // tree entry point / selector
    function tree (path) {
        return data[path] || createNode(path)
    }
    Object.defineProperties(tree, {
        // tree node count getter
        nodeCount: { enumerable: true, get: function () {
            return Object.keys(data).length
        } },
        // stream tree changes
        createStream: { value: createStream },
        // expose tree node prototype
        node: { value: TreeNode.prototype }
    })

    // initialize root node
    var rootNode = createNode('/').persist()
    Object.defineProperties(rootNode, {
        remove: { value: function () {
            throw new Error('Can not remove root node.')
        } },
        parent: { enumerable: true, value: null }
    })

    return tree
}
