// @ts-nocheck
const itpipe = require('it-pipe');

class RPCHandler {
  constructor(stream, RPC) {
    if (RPC && RPC.constructor !== Object) {
      throw new Error('Cannot pass instances as RPC interfaces.');
    }

    this.stream = stream;
    this.RPC = RPC;
    this.registry = new Map();
    this.prepareRPC(RPC);
    this.handleRPC(stream);
  }

  prepareRPC(RPC) {
    const methods = {};
    const props = {};

    for (const key in RPC) {
      if (typeof RPC[key] === 'function') {
        this.registry.set(key, RPC[key]);
      } else {
        props[key] = RPC[key];
      }
    }
    return { methods, props };
  }

  async handleRPC(stream) {
    // getting data
    const parsedInputs = [];
    let result = { done: false };

    while (!result.done) {
      // eslint-disable-line
      result = await stream.source.next();
      if (result.done) break;
      parsedInputs.push(
        result.value.toString(),
      );
    }

    // parse function info
    const promises = this.parseRPCs(parsedInputs);

    // do all promises andd pipe back to stream
    Promise.all(promises).then(async (values) => {
      await itpipe(
        values,
        stream,
      );
    });
  }

  async generateMethod(key, args) {
    let ret = this.registry.get(key)(...args);
    if (ret && ret.then) ret = await ret;
    if (ret && ret.constructor === Object) {
      ret = this.prepareRPC(ret);
    }
    return ret;
  }

  parseRPCs(inputs) {
    const result = [];

    inputs.forEach((str) => {
      const rpc = JSON.parse(str);
      const { method } = rpc;
      const args = rpc.props;

      result.push(this.generateMethod(method, args));
    });

    return result;
  }
}

module.exports = RPCHandler;
