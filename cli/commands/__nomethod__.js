'use strict';

const chalk = require('chalk');
const Command = require('cmnd').Command;
const fs = require('fs');
const path = require('path');

const LocalGateway = require('../local_gateway.js');
const FunctionParser = require('functionscript').FunctionParser;
const config = require('../config.js');

function parseFileFromArg(arg) {
  if (arg.indexOf('file:') === 0) {
    let filename = arg.slice('file:'.length);
    let file;
    try {
      file = fs.readFileSync(filename);
      file = JSON.stringify({_base64: file.toString('base64')});
    } catch (e) {
      return new Error(`Can not read file: "${filename}"`);
    }
    return file;
  }
  return arg;
}

const lib = require('lib');

class __nomethod__Command extends Command {

  constructor() {

    super('*');

  }

  help() {

    return {
      description: 'Runs a Standard Library function, i.e. "lib user.service[@env]" (remote) or "lib ." (local)',
      flags: {
        b: 'Execute as a Background Function',
        d: 'Specify debug mode (prints Gateway logs locally, response logs remotely)',
        t: 'Specify a Library Token to use manually',
        x: 'Unauthenticated - Execute without a token (overrides active token and -t flag)'
      },
      vflags: {
        '*': 'all verbose flags converted to named keyword parameters'
      }
    };

  }

  run(params, callback) {

    let debug = !!params.flags.d;
    let isLocal = false;
    let gateway;

    if (params.name.indexOf('.') === -1) {
      if (params.name.indexOf('/') > -1) {
        let names = params.name.split('/');
        if (names[1].indexOf('@') > -1) {
          names[1] = names[1].split('@');
          if (names[1].length > 1) {
            names[1][1] = names[1][1] && `[@${names[1][1]}]`;
          }
          names[1] = names[1].slice(0, 2).join('');
        }
        return callback(new Error(`Deprecated service path usage, please try \`lib ${names.join('.')}\` instead`));
      }
      return callback(new Error(`Command "${params.name}" does not exist.`));
    } else if (params.name[0] === '.') {
      isLocal = true;
      let pkg;
      let env;
      try {
        pkg = require(path.join(process.cwd(), 'package.json'));
      } catch (e) {
        if (!config.workspace()) {
          return callback(new Error([
            'You have not set up a Standard Library workspace yet.',
            '\nTry running `lib init` in a directory that you would like to use as a workspace.'
          ].join('')));
        } else if (!config.location(2)) {
          return callback(
            new Error(
              [
                'There was an error parsing "package.json" from this directory.',
                '\nIt could be malformed, but it\'s more likely you\'re running',
                ' this command from the wrong directory.',
                '\n\nYour Standard Library workspace is located in:',
                '\n  ' + config.workspace(),
                '\nAnd you\'re currently in:',
                '\n  ' + process.cwd(),
                '\n\nStandard Library services are normally two levels down from your workspace directory.',
                '\n  (i.e. workspace/username/servicename)'
              ].join('')
            )
          );
        } else if (!fs.existsSync(path.join(process.cwd(), 'package.json'))) {
          return callback(new Error(
            [
              'There was no "package.json" found in this directory, you may have deleted it.',
              '\nTry creating a new service (using `lib create`) from your Standard Library workspace directory:',
              '\n  ' + config.workspace()
            ].join(''))
          );
        } else {
          return callback(new Error('Invalid "package.json" in this directory, your JSON syntax is likely malformed.'));
        }
      }
      try {
        env = require(path.join(process.cwd(), 'env.json'));
      } catch (e) {
        if (!config.workspace()) {
          return callback(new Error([
            'You have not set up a Standard Library workspace yet.',
            '\nTry running `lib init` in a directory that you would like to use as a workspace.'
          ].join('')));
        } else if (!config.location(2)) {
          return callback(
            new Error(
              [
                'There was an error parsing "env.json" from this directory.',
                '\nIt could be malformed, but it\'s more likely you\'re running',
                ' this command from the wrong directory.',
                '\n\nYour Standard Library workspace is located in:',
                '\n  ' + config.workspace(),
                '\nAnd you\'re currently in:',
                '\n  ' + process.cwd(),
                '\n\nStandard Library services are normally two levels down from your workspace directory.',
                '\n  (i.e. workspace/username/servicename)'
              ].join('')
            )
          );
        } else if (!fs.existsSync(path.join(process.cwd(), 'env.json'))) {
          return callback(new Error(
            [
              'There was no "env.json" found in this directory, you may have deleted it.',
              '\nTry creating a new service (using `lib create`) from your Standard Library workspace directory:',
              '\n  ' + config.workspace()
            ].join(''))
          );
        } else {
          return callback(new Error('Invalid "env.json" in this directory, your JSON syntax is likely malformed.'));
        }
      }
      if (pkg.stdlib.build !== 'legacy') {
        gateway = new LocalGateway({debug: debug});
        let fp = new FunctionParser();
        try {
          gateway.service(pkg.stdlib.name);
          gateway.environment(env.local || {});
          gateway.define(fp.load(process.cwd(), 'functions'));
        } catch (e) {
          return callback(e);
        }
        gateway.listen();
        params.name = `${pkg.stdlib.name.replace(/\//gi, '.')}[@local]${params.name.length > 1 ? params.name : ''}`;
      }
    }

    if (params.args.length) {
      return callback(new Error('Must pass in named parameters with `--name value` or flags with `-f`, unnamed arguments not supported.'));
    }

    let kwargs = Object.keys(params.vflags).reduce((kwargs, key) => {
      kwargs[key] = parseFileFromArg(params.vflags[key].join(' '));
      return kwargs;
    }, {});

    let errors = Object.keys(kwargs).map(key => kwargs[key])
      .filter(arg => arg instanceof Error);

    if (errors.length) {
      return callback(errors[0]);
    }

    let activeToken = config.get('ACTIVE_LIBRARY_TOKEN');
    let unauth = !!params.flags.x;

    if (!activeToken && !unauth) {
      console.log();
      console.log(chalk.bold.red('Oops!'));
      console.log();
      console.log(`It seems like you\'re trying to run a Standard Library function,`);
      console.log(`  but you don't have an Active Library Token (API Key) set.`);
      console.log();
      console.log('You can run this command again without authentication by specifying:');
      console.log(`\t${chalk.bold('lib ' + params.name + ' -x')}`);
      console.log();
      console.log(`But we recommend setting an Active Library Token with:`);
      console.log(`\t${chalk.bold('lib tokens')}`);
      console.log();
      return callback(new Error(`No Library Token value set.`));
    }

    let setToken = unauth ? false : !!params.flags.t;
    let token = unauth ?
      null :
      (params.flags.t && params.flags.t[0]) || activeToken || null;
    let webhook = (params.flags.w && params.flags.w[0]) || null;
    let bg = params.flags.b ? (params.flags.b[0] || true) : null;
    let hostname = (params.flags.h && params.flags.h[0]) || '';
    let matches = hostname.match(/^(https?:\/\/)?(.*?)(:\d+)?$/);
    let host;
    let port;

    if (setToken && isLocal) {
      console.log();
      console.log(chalk.bold.red('Oops!'));
      console.log();
      console.log(`It seems like you\'re trying to run an authenticated request with a library token (-t),`);
      console.log(`  but the function you're running is ${chalk.green('running locally')}.`);
      console.log();
      console.log('Local authentication via Standard Library is not supported.');
      console.log('Please ship your service to a cloud-based development environment using:');
      console.log(`\t${chalk.bold('lib up dev')}`);
      console.log();
      console.log(`Or simply run your service locally again ${chalk.red('without the ')}${chalk.bold.red('-t')}${chalk.red(' flag')}.`);
      console.log();
      return callback(new Error(`Can not use Library Tokens locally.`));
    } else if (setToken && !token) {
      console.log();
      console.log(chalk.bold.red('Oops!'));
      console.log();
      console.log(
        `It seems like you\'re trying to run an authenticated request with` +
        ` a library token (-t), but have not provided a value`
      );
      console.log();
      console.log(`Try running this command again using the flag:`);
      console.log(`\t${chalk.bold('-t <token>')}`);
      console.log();
      console.log(`Or learn more about setting an active Library Token using:`);
      console.log(`\t${chalk.bold('lib help tokens')}`);
      console.log();
      return callback(new Error(`No Library Token value set.`));
    }

    if (hostname && matches) {
      host = matches[2];
      port = parseInt((matches[3] || '').substr(1) || (hostname.indexOf('https') === 0 ? 443 : 80));
    }

    let debugLog = msg => {
      if (!debug) {
        return;
      }
      msg = msg || '';
      let prefix = '> ';
      return console.log(
        msg
          .split('\n')
          .map(line => chalk.grey(prefix + (line || '')))
          .join('\n')
      );
    }

    let cb = (err, result, headers) => {

      let responseMessage = `Response Received `;
      let localityMessage = isLocal ? `(local)` : `(remote)`;
      let localityFormatted = isLocal ?
        chalk.green(localityMessage) :
        chalk.cyan(localityMessage);

      if (headers) {
        let content = headers['content-type'];
        let size = headers['content-length'];
        let time = headers['x-stdlib-time'];
        let data = [
          `Content-Type:    ${content}`,
          `Content-Length:  ${size} bytes`,
          `X-StdLib-Time:   ${time} milliseconds`
        ];
        let separator = Array(Math.max.apply(null, data.map(s => s.length)) + 1).join('-')
        debugLog(`${responseMessage}${localityFormatted}`);
        debugLog(separator);
        debugLog(data.join('\n'));
        debugLog(separator);
      } else {
        debugLog(`${responseMessage}${localityFormatted}`);
        debugLog(Array(responseMessage.length + localityMessage.length + 1).join('-'));
      }

      if (err) {
        if (err.code == 'HPE_INVALID_CONSTANT') {
          err.message = [
            err.message,
            'Received HTTP error code "HPE_INVALID_CONSTANT"',
            'This is likely due to an invalid "Content-Length" header field',
            'Standard Library will set this field for you, you do not need to write it manually'
          ].join('\n');
        } else {
          let message = err.message || '';
          if (err.type === 'ParameterError' || err.type === 'ValueError') {
            let params = err.details || {};
            Object.keys(params).forEach(name => {
              message += `\n - [${name}] ${params[name].message}`;
            });
            delete err.details;
          }
          err.message = message;
        }
      } else {
        if (result instanceof Buffer) {
          console.log(result.toString('binary'));
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }

      if (gateway && gateway._requestCount) {
        gateway.once('empty', () => callback(err));
      } else {
        callback(err);
      }

    };

    let hostString = host ? (port ? `${host}:${port}` : host) : '';

    debugLog();
    debugLog(
      `Running ${chalk[isLocal ? 'green' : 'cyan'](params.name)}` +
      (hostString ? ` on ${chalk.cyan(hostString)}` : ``) +
      `...`
    );
    debugLog(
      token ?
        `(authenticating using library token ${chalk.yellow(token.substr(0, 8) + '...')})` :
        `(unauthenticated request)`
    );
    debugLog();

    try {
      let cfg = {token: token, host: host, port: port, webhook: webhook, bg: bg, convert: true};
      lib(cfg)[params.name](kwargs, cb);
    } catch(e) {
      console.error(e);
      return callback(e);
    }

  }

}

module.exports = __nomethod__Command;
