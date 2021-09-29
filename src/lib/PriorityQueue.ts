import { BigNumber } from 'ethers'
import { BigNumberish, Wallet } from 'ethers'
const config = require('../config/default.json')

export class PriorityNode {
  txData: string

  tokenId: string

  feeAmount: BigNumber

  gasPrice: BigNumber = BigNumber.from('0')

  gas: BigNumber = BigNumber.from('0')

  feeReceiver: string;

  next!: PriorityNode

  constructor(
    txData: string,
    tokenId: string,
    feeAmount: BigNumberish,
    gas: BigNumberish,
    feeReceiver: string
  ) {
    this.txData = txData
    this.tokenId = tokenId
    this.feeAmount = BigNumber.from(feeAmount)
    this.gas = BigNumber.from(gas)
    this.feeReceiver = feeReceiver
  }

  public computeGasPrice(priceInEth: number) {
    let tokenConfigDecimal: number = parseInt(
      config['acceptedTokens']![this.tokenId]!['decimal'],
    )
    let priceIn8Decimal = Math.floor(priceInEth * Math.pow(10, 8))

    let expectedFeeInWei = BigNumber.from(this.feeAmount)
      .mul(priceIn8Decimal)
      .mul(BigNumber.from('10').pow(18))
      .div(BigNumber.from('10').pow(tokenConfigDecimal))
      .div(BigNumber.from('10').pow(8))

    let estimatedGasPrice = expectedFeeInWei.div(this.gas)
    this.gasPrice = estimatedGasPrice
    return estimatedGasPrice
  }

  public isNull() {
    return this.txData.length == 0 || this.gasPrice.eq('0')
  }
}

export class PriorityQueue {
  head!: PriorityNode
  tail!: PriorityNode
  wallet: Wallet
  constructor(wallet: Wallet) {
    this.wallet = wallet
  }
  public enqueue(
    txData: string,
    tokenId: string,
    feeAmount: string,
    gas: BigNumberish,
    feeReceiver: string,
    priceInEth: number,
  ): PriorityNode {
    const node = new PriorityNode(txData, tokenId, feeAmount, gas, feeReceiver)
    node.computeGasPrice(priceInEth)
    return this.insert(node)
  }

  insert(node: PriorityNode): PriorityNode {
    let gasPrice = node.gasPrice

    if (!this.head) {
      this.head = this.tail = node
    } else {
      let previous = this.head
      if (previous.gasPrice < gasPrice) {
        node.next = previous
        this.head = node
        return node
      }
      let next = previous?.next
      while (previous && next) {
        if (next.gasPrice < gasPrice) {
          node.next = next
          previous.next = node
          return node
        }
        previous = previous.next
        next = next.next
      }

      this.tail.next = node
      this.tail = node
    }
    return node
  }

  public updateQueueNode(node: PriorityNode, priceInEth: number) {
    //recompute gasPrice and sort the queue
    node.computeGasPrice(priceInEth)
    let previous = this.head
    let iter = previous.next
    while (iter != node) {
      previous = iter
      iter = iter.next
      if (!iter) {
        break;
      }
    }
    if (iter) {
      previous.next = iter.next
    } else {
      this.head = this.head.next
    }
    this.insert(node)
  }

  public dequeue(): PriorityNode {
    if (!this.head) {
      return new PriorityNode('', '0', '0', '0', "")
    }
    const oldHead = this.head
    this.head = oldHead.next
    return oldHead
  }

  public peek(): PriorityNode {
    return this.head
  }

  public isEmpty(): boolean {
    return this.head == null
  }

  public get data() {
    const values = []
    let head = this.head
    while (head) {
      values.push(head.txData)
      head = head.next
    }
    return values
  }
}
