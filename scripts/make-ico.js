const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const src = path.join(__dirname, 'icon-out');
const assets = path.join(__dirname, '..', 'assets');

const icoSizes = [16, 24, 32, 48, 64, 256].map((size) => path.join(src, `icon-${size}.png`));

pngToIco(icoSizes)
  .then((buf) => {
    fs.writeFileSync(path.join(assets, 'icon.ico'), buf);
    fs.copyFileSync(path.join(src, 'icon-512.png'), path.join(assets, 'icon.png'));
    fs.copyFileSync(path.join(src, 'icon-32.png'), path.join(assets, 'tray.png'));
    console.log('assets/icon.ico, assets/icon.png, assets/tray.png updated');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
