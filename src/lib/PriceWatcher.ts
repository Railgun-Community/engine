const config = require('../config/default.json')
import { CoinGeckoAPI } from "@coingecko/cg-api-ts";
const fetch = require('node-fetch')

//interface Token

export class PriceWatcher {
  tokenPrices = new Map<string, number>()
  constructor() {
  }

  public start() {
    this.setSafeInterval(this, this.readingPrices, 120000)
  }

  setSafeInterval(t: PriceWatcher, func: Function, interval: number) {
    func(t)
      .catch(console.error)
      .finally(() => {
        setTimeout(() => this.setSafeInterval(t, func, interval), interval)
      })
  }

  async readingPrices(t: PriceWatcher) {
    const acceptedTokens = config['acceptedTokens']
    const acceptedTokenSyms = Object.keys(acceptedTokens)
    const tokenIds = acceptedTokenSyms.map((e: string) => {
        return acceptedTokens[e]["name"]
    })
    let cg = new CoinGeckoAPI(fetch)
    let ret = await cg.getSimplePrice(tokenIds, ["usd"])
    let data = ret.data
    
    for(var i = 0; i < tokenIds.length; i++) {
        let sym = acceptedTokenSyms[i]
        t.tokenPrices.set(sym, parseFloat(data[tokenIds[i]]["usd"].toString()))
    }
    console.log('prices', t.tokenPrices)
  }

  public getPriceInETH(tokenId: string) {
      return (this.tokenPrices.get(tokenId) || 0) / (this.tokenPrices.get("eth") || 1)
  }
}
