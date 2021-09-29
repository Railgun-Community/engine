const itpipe = require('it-pipe')
const config = require('../config/default.json')

const Libp2p = require('libp2p')
const TCP = require('libp2p-tcp')
const { NOISE } = require('libp2p-noise')
const MPLEX = require('libp2p-mplex')

const { WithdrawObject } = require('./types')
const ethers = require('ethers')
const Web3 = require('web3')
import { Wallet } from 'ethers'
import { PriceWatcher } from '../lib/PriceWatcher'
import { PriorityNode, PriorityQueue } from '../lib/PriorityQueue'
const PrivateKeyProvider = require('truffle-privatekey-provider')

class RPCHandler {
  stream: any
  RPC: any
  registry: any
  providerUrl: string
  wallets: Array<Wallet>
  queues: Array<PriorityQueue>
  priceWatcher: PriceWatcher
  node: any
  provider: any
  privateKeys: Array<string>

  constructor(stream: any, RPC: any) {
    if (RPC && RPC.constructor !== Object) {
      throw new Error('Cannot pass instances as RPC interfaces.')
    }

    this.stream = stream
    this.RPC = RPC
    this.registry = new Map()

    this.providerUrl = config['blockchain']['httpProvider']
    this.provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    this.wallets = new Array<Wallet>()
    this.privateKeys = new Array<string>()
    this.queues = new Array<PriorityQueue>()

    let accounts = config['accounts'] as Array<string>
    for (var i = 0; i < accounts.length; i++) {
      let wl = new Wallet(accounts[i], this.provider)
      this.wallets.push(wl)
      this.privateKeys.push(accounts[i])

      //create a corresponding queue
      let queue = new PriorityQueue(wl)
      this.queues.push(queue)
    }

    this.priceWatcher = new PriceWatcher()

    this.priceWatcher.start()

    this.prepare()
  }

  async prepare() {
    this.node = await this.createNode()
    await this.node.start()

    this.prepareRPC(this.RPC)

    this.handleRPC(this.stream)
    this.handleRelayerMethods()
    this.handleWithdrawRPC()

    for(var i = 0; i < this.queues.length; i++) {
      this.startMonitoringQueue(i)
    }
  }

  async createNode() {
    const node = await Libp2p.create({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0'],
      },
      modules: {
        transport: [TCP],
        streamMuxer: [MPLEX],
        connEncryption: [NOISE],
      },
    })

    return node
  }

  prepareRPC(RPC: any) {
    const methods = {}
    const props = new Map()

    for (const key in RPC) {
      if (typeof RPC[key] === 'function') {
        this.registry.set(key, RPC[key])
      } else {
        props.set(key, RPC[key])
      }
    }
    return { methods, props }
  }

  handleRelayerMethods() {
    this.node.handle('supportedtokens', async ({ stream }: any) => {
      const acceptedTokens = JSON.stringify(config['acceptedTokens'])

      // do all promises andd pipe back to stream
      await itpipe(acceptedTokens, stream)
    })
  }

  handleWithdrawRPC() {
    let pushToQueue = this.pushToQueue
    let priceWatcher = this.priceWatcher
    this.node.handle('withdraw/v1', async ({ stream }: any) => {
      try {
        await itpipe(stream, async function (source: any) {
          for await (const msg of source) {
            let obj: InstanceType<typeof WithdrawObject> = JSON.parse(msg)
            let node: PriorityNode = new PriorityNode(
              obj.rawTransaction,
              obj.feeToken,
              obj.fee,
              obj.gasLimit,
              obj.address,
            )
            node.computeGasPrice(priceWatcher.getPriceInETH(obj.feeToken))
            pushToQueue(node)
          }
        })
        await itpipe([], stream)
      } catch (err) {
        //logger.error(err)
      }
    })
  }

  async startMonitoringQueue(index: number) {
    let queue: PriorityQueue = this.queues[index]
    let thisFunction = this.startMonitoringQueue
    //updating queue
    if (!queue.head) {
      //empty queue
      //wait 10 seconds
      setTimeout(() => {
        thisFunction(index)
      }, 10000)
    } else {
      let item = queue.dequeue()

      let key = this.privateKeys[index].replace('0x', '')
      let provider = await new PrivateKeyProvider(key, this.providerUrl)
      let web3 = new Web3(provider)
      try {
        await web3.eth.sendTransaction({
          from: this.wallets[index].address,
          to: config['contractAddress'],
          value: 0,
          gas: item.gas,
          gasPrice: item.gasPrice,
          data: item.txData,
        })
      } catch (e) {}

      setTimeout(() => {
        thisFunction(index)
      }, 10000)
    }
  }

  async pushToQueue(node: PriorityNode) {
    //finding wallets index
    for (var i = 0; i < this.wallets.length; i++) {
      let wl = this.wallets[i]
      if (node.feeReceiver.toLowerCase() == wl.address.toLowerCase()) {
        let web3 = new Web3(this.providerUrl)
        let nonce = await web3.eth.getTransactionCount(wl.address)
        try {
          let gasAmount = await web3.eth.estimateGas({
            from: wl.address,
            nonce: nonce,
            to: config['contractAddress'],
            data: node.txData,
          })
          if (parseInt(gasAmount) <= node.gas.toNumber()) {
            this.queues[i].insert(node)
          }
        } catch (e) {}
        break
      }
    }
  }

  async handleRPC(stream: any) {
    // getting data
    const parsedInputs = []
    let result = { done: false, value: '' }

    while (!result.done) {
      // eslint-disable-line
      result = await stream.source.next()
      if (result.done) break
      parsedInputs.push(result.value.toString())
    }

    // parse function info
    const promises = this.parseRPCs(parsedInputs)

    // do all promises andd pipe back to stream
    Promise.all(promises).then(async (values) => {
      await itpipe(values, stream)
    })
  }

  async generateMethod(key: any, args: any) {
    let ret = this.registry.get(key)(...args)
    if (ret && ret.then) ret = await ret
    if (ret && ret.constructor === Object) {
      ret = this.prepareRPC(ret)
    }
    return ret
  }

  parseRPCs(inputs: string[]) {
    const result = new Array<any>()

    inputs.forEach((str) => {
      const rpc = JSON.parse(str)
      const { method } = rpc
      const args = rpc.props

      result.push(this.generateMethod(method, args))
    })

    return result
  }
}

module.exports = RPCHandler
