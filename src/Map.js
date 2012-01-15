/**
 * @fileOverview Sisältää {@link Map}-luokan toteutuksen.
 */

/**#nocode+*/
var log = require('./Utils').log
  , rand = require('./Utils').rand
  , truncateNumber = require('./Utils').truncateNumber
  , distance = require('./Utils').distance
  , path = require('path')
  , cjson = require('cjson')
  , colors = require('colors')
  , Item = require('./Item')
  , ITM = require('./Constants').ITM;
/**#nocode-*/

/**
 * Lataa uuden kartan.
 * @class Karttaluokka
 *
 * @param {Server} server  Tämän kartan NetMatch-palvelin
 * @param {String} name    Kartan nimi, joka ladataan (esim. Luna)
 *
 * @property {Boolean} loaded                 Ladattiinko kartta onnistuneesti
 * @property {String}  name                   Kartan nimi
 * @property {String}  author                 Kartan tekijä
 * @property {String}  crc32                  Kartan CRC32-tunniste, jota tarvitaan CoolBasicin puolella
 * @property {Object}  config                 Kartan asetukset sisältävä objekti
 * @property {Integer} config.maxPlayers      Maksimipelaajat
 * @property {Integer} config.botCount        Bottien määrä
 * @property {Integer} config.botDepartLimit  Kun pelaajamäärä ylittää tämän arvon, poistuu botti pelistä
 * @property {Array}   config.botNames        Bottien nimet
 * @property {Array}   config.botWeapons      Bottien aseet (1 = pistooli, 2 = konepistooli, 3 = sinko,
 *                                            4 = haulikko, 5 = kranaatinlaukaisin, 6 = moottorisaha)
 * @property {Integer} config.healthItems     Lääkintäpakkausten määrä
 * @property {Integer} config.mgunItems       Konekiväärin ammuslaatikoiden määrä
 * @property {Integer} config.bazookaItems    Singon rakettilaatikoiden määrä
 * @property {Integer} config.shotgunItems    Haulikon haulilaatikoiden määrä
 * @property {Integer} config.launcherItems   Kranaatinlaukaisimen kranaattilaatikoiden määrä
 * @property {Integer} config.chainsawItems   Moottirisahan bensakanistereiden määrä
 * @property {Integer} tileSize               Yhden tilen leveys/korkeus pikseleissä
 * @property {Integer} width                  Kartan leveys
 * @property {Integer} height                 Kartan korkeus
 * @property {Array}   data                   Törmäyskerroksen data yksiulotteisessa taulukossa
*/
function Map(server, name) {
  var filePath = path.resolve(__dirname, '..', 'maps', name + '.json')
    , data, buffer, uint8View;

  this.server = server;
  this.loaded = false;

  if (!path.existsSync(filePath)) {
    log.error('Map %0 doesn\'t exist in %1', name.green, filePath.green);
    return;
  }

  log.info('Loading map %0 from %1', name.green, filePath.green);
  data = cjson.load(filePath);
  // Laajennetaan tämän kartan ominaisuuksia ladatulla json-tiedostolla
  cjson.extend(this, data);

  // Muunnetaan törmäyskerroksen data 8-bittiseksi, yksiulotteiseksi taulukoksi
  buffer = new ArrayBuffer(this.width * this.height);
  uint8View = new Uint8Array(buffer);
  for (var y = 0; y < this.height; ++y) {
    for (var x = 0; x < this.width; ++x) {
      var index = y * this.width + x;
      uint8View[index] = this.data[y][x];
    }
  }
  this.data = uint8View;

  // Alustetaan kartan tavarat
  this.initItems();

  this.loaded = true;
}

/**
 * Törmätäänkö kartan hit-kerrokseen annetuissa pelikoordinaateissa.
 *
 * @param {Number} x  Tarkistettava x-koordinaatti pelikoordinaateissa
 * @param {Number} y  Tarkistettava y-koordinaatti pelikoordinaateissa
 */
Map.prototype.isColliding = function (x, y) {
  var tileX = Math.ceil((x + this.width * this.tileSize / 2) / this.tileSize) - 1
    , tileY = Math.ceil((-y + this.height * this.tileSize / 2) / this.tileSize) - 1
    , index;

  if (tileX < 0 || tileX >= this.width || tileY < 0 || tileY >= this.height) {
    // Ollaan kartan ulkopuolella, eli törmätään.
    return true;
  }

  // Lasketaan tilen paikka yksiulotteisessa taulukossa
  index = tileY * this.width + tileX;

  if (this.server.debug) {
    if ('undefined' === typeof this.data || 'undefined' === typeof this.data[index]) {
      log.error('Map.data[%0] (%1, %2) is undefined', index, tileY, tileX);
    }
  }

  // Nyt tarkistetaan että ollaanko seinän sisällä
  if (this.data[index]) {
    return true;
  }

  // Jos päästiin tänne asti niin ei olla törmätty
  return false;
};

/**
 * Etsii satunnaisen paikan kartalta, joka ei ole seinän sisällä, ja palauttaa kyseisen paikan
 * koordinaatit objektissa, jolla on kentät x ja y.
 *
 * @returns {Object}  Objekti, jolla on kentät x ja y, jotka ovat löydetyn paikan koordinaatit
 */
Map.prototype.findSpot = function () {
  var randTileX, randTileY, index, returnObj = {};
  // Etsitään vapaata paikkaa kartalta "vain" 10 000 kertaa
  for (var i = 9999; --i;) {
    randTileX = rand(0, this.width - 1);
    randTileY = rand(0, this.height - 1);
    // Lasketaan tilen paikka yksiulotteisessa taulukossa
    index = randTileY * this.width + randTileX;

    if (!this.data[index]) {
      // Ei ollut seinän sisällä
      returnObj.x = (randTileX * this.tileSize)
                  - (this.width * this.tileSize) / 2
                  + this.tileSize / 2;
      returnObj.y = -((randTileY * this.tileSize)
                  - (this.height * this.tileSize) / 2
                  + this.tileSize / 2);
      break;
    }
  }
  return returnObj;
};

/**
 * Alustaa kartalla olevat tavarat.
 */
Map.prototype.initItems = function () {
  var itemId = 0;

  for (var i = this.config.healthItems - 1; i--;) {
    new Item(this.server, this, ++itemId, ITM.HEALTH);
  }
  for (i = this.config.mgunItems - 1; i--;) {
    new Item(this.server, this, ++itemId, ITM.AMMO);
  }
  for (i = this.config.bazookaItems - 1; i--;) {
    new Item(this.server, this, ++itemId, ITM.ROCKET);
  }
  for (i = this.config.shotgunItems - 1; i--;) {
    new Item(this.server, this, ++itemId, ITM.SHOTGUN);
  }
  for (i = this.config.launcherItems - 1; i--;) {
    new Item(this.server, this, ++itemId, ITM.LAUNCHER);
  }
  for (i = this.config.chainsawItems - 1; i--;) {
    new Item(this.server, this, ++itemId, ITM.FUEL);
  }
};

/**
 * Etsii annettujen koordinaattien ja kulman muodostavalta suoralta lähimmän seinän koordinaatit
 * ja palauttaa ne objektin kenttinä x ja y.
 *
 * @param {Number} x      Aloituspisteen x-koordinaatti
 * @param {Number} y      Aloituspisteen y-koordinaatti
 * @param {Number} angle  Mihin suuntaan suora muodostuu (asteina)
 *
 * @returns {Object}  Palauttaa objektin jolla on kentät x ja y jotka sisältävät lähimmän seinän
 *                    koordinaatit.
 */
Map.prototype.findWall = function (x, y, angle, dist) {
  var startP = {}, endP = {}, returnP;

  // Muunnetaan x ja y maailmankoordinaateista "näyttökoordinaateiksi"
  startP.x = x + this.width * this.tileSize / 2;
  startP.y = -y + this.height * this.tileSize / 2;

  // Lasketaan loppupiste
  endP.x = startP.x + Math.cos((-angle / 180) * Math.PI) * dist;
  endP.y = startP.y + Math.sin((-angle / 180) * Math.PI) * dist;

  // Suoritetaan raycast
  returnP = this.rayCast(startP, endP);

  if (!returnP) {
    // Välissä ei ollut seinää, ei palauteta mitään.
    //console.log("No hits with raycast");
    return;
  }

  // Muunnetaan "näyttökoordinaatit" maailmankoordinaateiksi
  returnP.x = returnP.x - (this.width * this.tileSize / 2);
  returnP.y = (this.height * this.tileSize / 2) - returnP.y;

  // Palautetaan piste
  return returnP;
}

/** Raycast */
Map.prototype.rayCast = function (origP1, origP2) {
  // Pisteiden normalisaatio
  var p1 = {x: origP1.x / this.tileSize, y: origP1.y / this.tileSize}
    , p2 = {x: origP2.x / this.tileSize, y: origP2.y / this.tileSize}
    // Seuraavien muuttujien kommentointi löytyy myöhemmin funktiossa
    , stepX, stepY
    , rayDirX, rayDirY
    , ratioX, ratioY
    , deltaX, deltaY
    , testTile
    , maxX, maxY
    , endTile
    , hit
    , colP
    , index;

  // Ylitetäänkö minkään laatan rajoja
  if (truncateNumber(p1.x) === truncateNumber(p2.x) && truncateNumber(p1.y) === truncateNumber(p2.y)) {
    // Ei ylitä minkään laatan rajoja, joten ei voi olla törmäystä.
    return;
  }

  // Kumpaan suuntaan mennään x- ja y-suunnassa
  stepX = (p2.x > p1.x) ? 1 : -1;
  stepY = (p2.y > p1.y) ? 1 : -1;

  // Säteen suunta
  rayDirX = p2.x - p1.x;
  rayDirY = p2.y - p1.y;

  // Kuinka pitkälle liikutaan kummallakin akselilla kun toisella akselilla hypätään seuraavaan
  // kokonaiseen tileen
  ratioX = rayDirX / rayDirY;
  ratioY = rayDirY / rayDirX;

  // Muutos x- ja y-suunnassa
  deltaY = Math.abs(p2.x - p1.x);
  deltaX = Math.abs(p2.y - p1.y);

  // Alustetaan testiä varten käytettävät kokonaislukumuuttujat alkutilekoordinaatteihin
  // Huom: Käytetään normalisoituja versioita pisteestä origP1
  testTile = {x: truncateNumber(p1.x), y: truncateNumber(p1.y)};

  // Alustetaan ei-kokonaislukuhyppäys liikkumalla seuraavan tilen reunalle ja jakamalla saatu
  // arvo vastakkaisen akselin kokonaisluvulla.
  // Jos liikutaan positiiviseen suuntaan, siirrytään nykyisen tilen päähän, muulloin alkuun.
  if (stepX > 0) {
    maxX = deltaX * (1.0 - (p1.x % 1));
  } else {
    maxX = deltaX * (p1.x % 1);
  }
  if (stepY > 0) {
    maxY = deltaY * (1.0 - (p1.y % 1));
  } else {
    maxY = deltaY * (p1.y % 1);
  }

  // Lopputile
  endTile = {x: truncateNumber(p2.x), y: truncateNumber(p2.y)};

  // Nyt liikutaan!
  hit = 0;
  colP = {x: 0.0, y: 0.0};

  while (testTile.x !== endTile.x || testTile.y !== endTile.y) {
    if (maxX < maxY) {
      maxX += deltaX;
      testTile.x += stepX;

      if (testTile.x < 0 || testTile.x >= this.width || testTile.y < 0 || testTile.y >= this.height) {
        // Ollaan kartan ulkopuolella, eli törmätään.
        hit = 1;
      } else {
        // Lasketaan tilen paikka yksiulotteisessa taulukossa
        index = testTile.y * this.width + testTile.x;
        // Tarkistetaan onko tilekerroksessa hit-dataa
        hit = this.data[index];
      }
      if (hit) {
        // Raycast löysi törmäyksen
        colP.x = testTile.x;
        if (stepX < 0) { colP.x += 1.0; } // Jos mennään vasemmalle päin, lisätään yksi.
        colP.y = p1.y + ratioY * (colP.x - p1.x);
        colP.x *= this.tileSize; // Skaalataan törmäyspiste ylöspäin
        colP.y *= this.tileSize;
        // Palautetaan osumapiste
        return colP;
      }
    } else {
      maxY += deltaY;
      testTile.y += stepY;

      if (testTile.x < 0 || testTile.x >= this.width || testTile.y < 0 || testTile.y >= this.height) {
        // Ollaan kartan ulkopuolella, eli törmätään.
        hit = 0;
      } else {
        // Lasketaan tilen paikka yksiulotteisessa taulukossa
        index = testTile.y * this.width + testTile.x;
        // Tarkistetaan onko tilekerroksessa hit-dataa
        hit = this.data[index];
      }
      if (hit) {
        // Raycast löysi törmäyksen
        colP.y = testTile.y;
        if (stepY < 0) { colP.y += 1.0; } // Jos mennään ylöspäin, lisätään yksi.
        colP.x = p1.x + ratioX * (colP.y - p1.y);
        colP.x *= this.tileSize; // Skaalataan törmäyspiste ylöspäin
        colP.y *= this.tileSize;
        // Palautetaan osumapiste
        return colP;
      }
    }
  }

  // Jos tänne asti ollaan päästy, niin törmäystä ei ole löydetty. Ei siis palauteta mitään.
}

module.exports = Map;
