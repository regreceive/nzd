const log4js = require('log4js');
log4js.configure({
  appenders: [
    {type: 'console'}, {
      type: 'file',
      filename: 'logs/access.log',
      maxLogSize: 4096,
      backups: 4,
      category: 'normal'
    }
  ],
  replaceConsole: true
});

exports.logger = function (name) {
  var logger = log4js.getLogger(name);
  logger.setLevel('TRACE');
  return logger;
};
