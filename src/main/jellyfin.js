'use strict';

// Der Jellyfin-Client liegt in src/shared (er laeuft auch in der Web-/Handy-Fassung); hier bleibt die gewohnte Adresse fuer den Hauptprozess und die Tests.
module.exports = require('../shared/jellyfin');
