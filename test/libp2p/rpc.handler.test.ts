const Libp2p = require('libp2p')
const TCP = require('libp2p-tcp')
const { NOISE } = require('libp2p-noise')
const MPLEX = require('libp2p-mplex')

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const { expect } = chai;

const RPC = {
  /* basic method support */
  ping: () => 'pong',
  /* async methods work identicaly to sync methods */
  ping2: async () => 'pong2',
  /* supports binary types */
  pingBuffer: () => Buffer.from('pong'),
  /* you can also add static properties */
  API: 'v1'
}

const itpipe = require('it-pipe')
const RPCHandler = require('../../src/libp2p/RpcHandler')

const createNode = async () => {
  const node = await Libp2p.create({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0']
    },
    modules: {
      transport: [TCP],
      streamMuxer: [MPLEX],
      connEncryption: [NOISE]
    }
  })

  await node.start()

  return node
}

describe('Simple ping pong', () => {
  it('Should return pong after pinging', async() => {
    const [node1, node2] = await Promise.all([
      createNode(),
      createNode()
    ])
  
    // Add node's 2 data to the PeerStore
    node1.peerStore.addressBook.set(node2.peerId, node2.multiaddrs)
  
    // exact matching
    node2.handle('/rpc', async (streamData: any) => {
      return new RPCHandler(streamData.stream, RPC)
    })
  
    const { stream } = await node1.dialProtocol(node2.peerId, ['/rpc'])
  
    await itpipe(
      [JSON.stringify({
          method: "ping",
          props: ['']
        })
      ],
      stream,
      async(source: any) => {
        for await (let data of source) {
          expect(data.toString()).to.equal("pong");
          break;
        }
      }
    )
    
  });
});
