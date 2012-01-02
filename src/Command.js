/**
 * @fileOverview Serverikomentoihin liittyvät toiminnot
 */

/**#nocode+*/
var log = require('./Utils').log
  , NET = require('./Constants').NET
  , fs = require('fs');
/**#nocode-*/

/**
 * @private
 * @namespace Sisältää serverikomennot, joihin pääsee käsiksi {@link Command}-luokan call-metodilla.
 *
 * Komennot muodostuvat seuraavasti:
 * @property {Array}    params           Parametrit
 * @property {String}   params.name      Parametrin nimi
 * @property {String}   params.type      Parametrin tyyppi
 * @property {Boolean}  params.optional  Onko parametri vapaaehtoinen
 * @property {String}   params.help      Mihin parametriä käytetään
 * @property {String}   help             Mihin komentoa käytetään
 * @property {Boolean}  remote           Voiko komentoa kutsua klientillä
 * @property {Function} action           Komennon logiikka
 */
var Commands = {};

// Sisäänrakennetut komennot

/**
 * Help-komento tulostaa tietoja halutusta komennosta.
 * @param {String} [command]  Minkä komennot salat paljastetaan
 */
Commands.help = {
  params: [
    {name: 'command', type: 'command', optional: true, help: 'Which command\'s help to show'}
  ],
  help: 'Shows help about this server\'s commands. See ´commands´ for list of available commands.',
  remote: true,
  action: function commandsHelp() {
    var server = this;
    if (!arguments[1]) {
      arguments[1] = 'help';
    }
    if (arguments[0]) {
      this.commands.getHelpString(arguments[1]).split('\n').forEach(function (m) {
      server.serverMessage(m, arguments[0].playerId);
    });
    } else {
      console.log(this.commands.getHelpString(arguments[1]));
    }
  }
};

/**
 * Listaa kaikki komennot.
 * @param {Boolean} [verbose]  Tulostetaanko samalla helpit.
 */
Commands.commands = {
  params: [
    {name: 'verbose', type: 'boolean', optional: true, help: 'Spam a lot. Only serverside'}
  ],
  help: 'Lists available commands.',
  remote: true,
  action: function commandsCommands() {
    var server = this;
    if (!arguments[1]) {
      if (arguments[0]) {
        this.serverMessage('Commands: ' + Object.keys(Commands).join(', '), arguments[0].playerId);
      } else {
        console.log('Commands: '.green + Object.keys(Commands).join(', '));
      }
    } else { // Verbose
      Object.keys(Commands).map(function (i) {
        console.log(i.toUpperCase().green);
        console.log(server.commands.getHelpString(i));
      });
    }
  }
};

/**
 * Lähettää NET.SERVERMSG paketin klienteille.
 * @param {String} [message]  Viesti, joka lähetetään
 */
Commands.say = {
  params: [
    {name: 'message', type: 'string', optional: false, help: 'Message to send to all players'},
  ],
  help: 'Sends a server message to all players.',
  remote: false,
  action: function commandsSay() {
    var msg = Array.prototype.slice.call(arguments, 1).join(' ');
    this.serverMessage(msg);
  }
};

/** Sulkee palvelimen. */
Commands.close = {
  params: [],
  help: 'Closes the server.',
  remote: true,
  action: function commandsClose() {
    this.close();
  }
};

/** Listaa paikalla olevat pelaajat. */
Commands.list = {
  params: [],
  help: 'Lists all connected players.',
  remote: false,
  action: function commandsList() {
    var plr, plrs = [], playerIds = Object.keys(this.players);
    for (var i = playerIds.length; i--;) {
      plr = this.players[playerIds[i]];
      if (plr.active) { plrs.push(plr.name); }
    }
    log.info('%0 player(s) connected: %1', plrs.length, plrs.join(', '));
  }
};

/**
 * Heittää pelaajan pellolle
 * @param {Player} who     Pelaaja, joka potkaistaan. Nimi tai ID kelpaa
 * @param {String} reason  Selitys tälle hirmuteolle
 */
Commands.kick = {
  params: [
    {name: 'who',    type: 'player', optional: false, help: 'Player who needs to be kicked'},
    {name: 'reason', type: 'string', optional: true,  help: 'Message to display for the kicked player'}
  ],
  help: 'Removes the player from the server.',
  remote: true,
  action: function commandsKick() {
    var player
      , plrName = arguments[1]
      , reason  = arguments[2] || '';

    // Jos annettiinkin ID, niin vaihdetaan se nimeksi
    if (this.players[plrName]) {
      plrName = this.players[plrName].name;
    }

    player = this.getPlayer(plrName);
    if (!player) {
      log.notice('Sorry, player couldn\'t be found.');
    } else {
      // Vaihdetaan toinen parametri nollaksi, jos kutsut tulee palvelimelta, kun klientti on pätsätty, muuten MAV.
      this.kickPlayer(player.playerId, argument[0] && arguments[0].playerId || player.playerId, reason);
    }

  }
}

/**
 * Kirjaa pelaajan sisään adminiksi.
 * @param {Player} who    Pelaaja, joka kirjautuu
 * @param {String} pass   Salasana
 */
Commands.login = {
  params: [
    {name: 'pass', type: 'string',  optional: false, help: 'Password'}
  ],
  help: 'Logs a player in.',
  remote: true,
  action: function commandsLogin() {
    var player = arguments[0]
      , pass   = arguments[1];
    if (!player) {
      log.warn('Couldn\'t find player!');
      return;
    }
    if (player.admin) {
      this.serverMessage('You are already an admin!', player.playerId);
      return;
    }
    if (pass === this.config.password) {
      player.admin = true;
      this.serverMessage('You are now an admin!', player.playerId)
    } else {
      log.warn('Incorrect password!');
    }
  }
};

// Ladataan lisää komentoja Commands-kansiosta, jos semmoisia löytyy.
files = fs.readdirSync(__dirname + '/Commands');
log.info('Found and loaded %0 command-modules: %1', String(files.length).magenta,
  files.map(function loadCommands(fn) {
    var cmd = fn.toLowerCase().split('.')[0];
    Commands[cmd] = require(__dirname + '/Commands/' + fn);
    return cmd;
  }).join(', ').green
);


/**
 * Hoitaa komentojen sisäisen käsittelyn ja toteutuksen
 * @class Komentojen käsittely
 */
function Command(server) {
  this.server = server;
}

/**
 * Kutstuu haluttua komentoa halutuilla parametreillä. Komentojen konteksti (this) on aina serveri.
 * @param {String} name      Mitä komentoa kutsutaan
 * @param {Array}  [args]    Millä parametreillä kutsutaan
 * @param {Player} [player]  Kuka kutsui komentoa (undefined mikäli konsolista)
 */
Command.prototype.call = function (name, args, player) {
  var c = Commands[name];
  if (!c) {
    log.error('Command "%0" not recognized. You need ´help´.', name.yellow);
    return;
  }
  // Tarkistetaan sallitaanko komento klienteillä
  if (player && !c.remote) {
    log.warn('Player %0 tried to call ´%1´, denied.', player.name.green, name);
    return;
  }

  // Validoidaan argumentit - parametrien tyyppejä ei tarkasteta tässä vaan se on tehtävä manuaalisesti
  for (var i = 0; i < c.params.length; i++) {
    var p = c.params[i];
    // Jos parametri ei ole valinnainen ja argumentteja on liian vähän
    if (!p.optional && args.length <= i) {
      log.error('You must give parameter %0 %1. For more information see ´help %2´', ('{' + p.type + '}').grey, p.name.red, name);
      return;
    }
  }
  // Kutsutaan funktiota
  args.unshift(player); // Lisätään pelaaja ensimmäiseksi parametriksi
  c.action.apply(this.server, args);
};

/**
 * Luo merkkijonon, joka kertoo komennon tiedot hienosti muotoiltuna.
 * @param {String} name  Komento, jonka tiedot haluat
 */
Command.prototype.getHelpString = function (name) {
  var c = Commands[name];
  if (!c) {
    return 'Could not find help about "' + name + '". You need ´help´.';
  }
  var h =                     ' Description: ' + c.help +
    (c.params.length ?      '\n  Parameters: ' : '');
  // List parameters
  for (var i = 0; i < c.params.length; i++) {
    var p = c.params[i];
    h += '\n' +
      // Type
      padString('  {' + p.type + '} ', 15, true) +
      // Name
      padString((p.optional ? '[' + p.name + ']' : p.name), 10, false) +
      // Description
      ' – ' + p.help;
  }
  return h;
};

Command.prototype.suggest = function (partial) {
  var suggestions = [], plr
    , server = this.server
    , cmds = Object.keys(Commands)
    , cmdPart = partial.split(' ')[0]
    , args = partial.split(' ').slice(1)
    , playerIds = Object.keys(this.server.players)
    , c = Commands[cmdPart]; // Se saattaa alkaa jo täydellisellä komennolla

  // Jos rivi alkaa komennolla.
  if (c) {
    // Luupataan sen argumentit ja lisätään ehdotuksiin
    c.params.forEach(function paramLoop(p, i) {
      // Valitaan, mitä pitää tarkistaa parametrin tyypin perusteella
      switch (p.type) {
      case "player": // Pelaajien nikit on hyvä täydentää
        for (var j = playerIds.length; j--;) {
          plr = server.players[playerIds[j]];
          if (plr.name && startsWith(plr.name, args[i]) && plr.active) {
            // Pelaajan nimi alkaa argumentin alulla.
            suggestions.push(cmdPart + ' ' + plr.name);
          }
        }
        break;
      case "command": // Samoin komentojen nimet
        cmds.forEach(function commandLoop(s) {
          if (startsWith(s, args[i])) {
            // Komento alkaa argumentint alulla.
            suggestions.push(cmdPart + ' ' + s);
          }
        });
        break;
        // TODO: Muut + säätö
      }
    });
  } else { // Muussa tapauksessa täydennetään komennoksi.
    Object.keys(Commands).map(function (i) {
      if (startsWith(i, partial)) {
        suggestions.push(i + ' ');
      }
    });
  }

  return suggestions;
};

function startsWith(str1, str) {
  return str1.slice(0, str.length) === str;
}

// Thanks for benvie at #node for help!
function padString(s, l, r) {
  if (r) {
    return Array(Math.max(l - s.length + 1, 0)).join(' ') + s;
  } else {
    return s + Array(Math.max(l - s.length + 1, 0)).join(' ')
  }
}

module.exports = Command;
