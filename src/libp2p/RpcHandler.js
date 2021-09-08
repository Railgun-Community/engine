'use strict'
const itpipe = require('it-pipe')

class RPCHandler {
  constructor(stream, RPC) {
    if (RPC && RPC.constructor !== Object) {
      throw new Error('Cannot pass instances as RPC interfaces.')
    }

    this.stream = stream
    this.RPC = RPC
    this.registry = new Map()
    this._prepareRPC(RPC)
    this.handleRPC(stream)
  }

  _prepareRPC(RPC) {
    const methods = {}
    const props = {}
    for (const key in RPC) {
      if (typeof RPC[key] === 'function') {
        // const id = Math.random().toString()
        // methods[key] = id
        this.registry.set(key, RPC[key])
      } else {
        props[key] = RPC[key]
      }
    }
    return { methods, props }
  }

  async handleRPC(stream) {
    // getting data
    let parsedInputs = [];
    let result = { done: false }

    while (!result.done) {
      result = await stream.source.next()
      if (result.done) { continue; }
      parsedInputs.push(
        result.value.toString()
      )
    }

    // parse function info
    var promises = this.parseRPCs(parsedInputs)
    
    // do all promises andd pipe back to stream
    Promise.all(promises).then(async (values) => {
      await itpipe(
        values,
        stream
      )
    });
  }

  async _generateMethod(key, args) {
    let ret = this.registry.get(key)(...args)
    if (ret && ret.then) ret = await ret
    if (ret && ret.constructor === Object) {
      ret = this._prepareRPC(ret)
    }
    return ret
  }

  parseRPCs(inputs) {
    let result = [];

    inputs.forEach(str => {
      var rpc = JSON.parse(str)
      var method = rpc["method"]
      var args = rpc["props"]
      
      result.push(this._generateMethod(method, args))
    });

    return result
  }

}

module.exports = RPCHandler
