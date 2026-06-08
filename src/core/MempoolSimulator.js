export const MempoolSimulator = {
  getPlaceholderTransactions() {
    return [
      { hash: '0xA91...04E', label: 'Swap 12.4 ETH', gas: 28 },
      { hash: '0xB22...F19', label: 'Mint order', gas: 34 },
      { hash: '0xC07...88D', label: 'Liquidation watch', gas: 41 },
    ]
  },
}
