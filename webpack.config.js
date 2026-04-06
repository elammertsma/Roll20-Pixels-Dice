const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: 'inline-source-map',
  entry: {
    background: './src/background.ts',
    content: './src/content.ts',
    popup: './src/popup.ts',
    options: './src/options.ts',
    bridge: './src/bridge.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'src/popup.html', to: 'popup.html' },
        { from: 'src/bridge.html', to: 'bridge.html' },
        { from: 'src/options.html', to: 'options.html' },
        { from: 'src/styles.css', to: 'styles.css' },
        { from: 'images', to: 'images' },
        { from: 'messageTypes', to: 'messageTypes' }
      ]
    })
  ]
};
