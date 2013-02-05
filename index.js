#!/usr/bin/env node

var optimist = require('optimist')
  , spawn = require('child_process').spawn
  , path = require('path')
  , https = require('https')
  , url = require('url')
  , Batch = require('batch')

var tasks = {
  list: {
    fn: list,
    info: "list available deploy targets",
  },
  init: {
    fn: init,
    info: "<target> - prepares target to accept deployments",
  },
  start: {
    fn: start,
    info: "<target> - starts the remote server",
  },
  stop: {
    fn: stop,
    info: "<target> - stops the remote server",
  },
  diff: {
    fn: diff,
    info: "<target> [--branch branch] - display what will be deployed on target",
  },
  deploy: {
    fn: deploy,
    info: "<target> [--branch branch] - deploy code",
  },
  abort: {
    fn: abort,
    info: "<target> - aborts a hanging deploy",
  },
  monitor: {
    fn: monitor,
    info: "<target> - tail logs on target",
  },
};

main();

function main() {
  var optParser = optimist
    .demand(1)
    .usage(genUsage())
  var cmd = optParser.argv._[0];
  var task = tasks[cmd];
  if (task) {
    var packageJson = require(path.join(process.cwd(), "package.json"));
    if (! packageJson.rodent) {
      console.error("package.json missing 'rodent' config");
      process.exit(1);
    }
    task.fn(optParser, packageJson);
  } else {
    optParser.showHelp()
  }
}

function genUsage() {
  var usage = "Usage: $0 [command]\n\nAvailable commands:\n";
  var task;
  for (var taskName in tasks) {
    task = tasks[taskName];
    usage += "\n    " + taskName + "\t" + task.info;
  }
  return usage;
}

function list(optParser, packageJson) {
  var name, target;
  for (name in packageJson.rodent.targets) {
    target = packageJson.rodent.targets[name];
    console.log(name)
    target.ssh.hosts.forEach(printHost);
  }
  function printHost(host) {
    console.log("  " + host);
  }
}
function init(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.rodent.targets[targetName]
  var destAppPath = appPath(packageJson, targetName);
  var repoUrl = packageJson.repository.url;
  if (! repoUrl || packageJson.repository.type !== 'git') {
    console.error("package.json must have repository of type 'git'");
    process.exit(1);
  }
  sshs(targetConf.ssh, [
    "mkdir -p " + destAppPath,
    "git clone " + repoUrl + " " + destAppPath,
    "cd " + destAppPath,
    "npm install"
  ]);
}
function start(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.rodent.targets[targetName]
  var env = inlineEnv(targetConf.env);
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    env + " authbind --deep npm start"
  ]);
}
function stop(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.rodent.targets[targetName]
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    "npm stop"
  ]);
}
function deploy(optParser, packageJson) {
  var argv = optParser
    .demand(1)
    .default('branch', null)
    .argv;
  var targetName = argv._[1]
  var targetConf = packageJson.rodent.targets[targetName]
  var env = inlineEnv(targetConf.env);
  if (argv.branch) {
    proceed(null, argv.branch);
  } else {
    getDefaultBranch(proceed);
  }

  function proceed(err, branch) {
    if (err) {
      console.error("Unable to get current branch:", err.stack);
      return;
    }

    if (packageJson.rodent.flowdock) {
      notifyFlowdock(packageJson, targetName, branch);
    }

    sshs(targetConf.ssh, [
      "cd " + appPath(packageJson, targetName),
      "git fetch",
      "git checkout origin/" + branch,
      "git submodule update",
      "npm prune",
      "npm install",
      env + " npm run deploy",
    ]);
  }
}
function abort(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.rodent.targets[targetName]
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    "npm run deploy-abort"
  ]);
}
function monitor(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.rodent.targets[targetName]
  packageJson.rodent.commands = packageJson.rodent.commands || {};
  var tailCmd = packageJson.rodent.commands.monitor || "tail -f *.log";
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    tailCmd
  ]);
}

function diff (optParser, packageJson) {
  var argv = optParser
    .demand(1)
    .default('branch', null)
    .argv;
  var targetName = argv._[1]
  var targetConf = packageJson.rodent.targets[targetName]
  if (argv.branch) {
    proceed(null, argv.branch);
  } else {
    getDefaultBranch(proceed);
  }
  function proceed(err, branch) {
    if (err) {
      console.error("unable to get current branch:", err.stack);
      return;
    }
    getDeployDiff(packageJson, targetName, branch, "%C(yellow)%h%Creset %Cgreen%cd%Creset %Cred%an%Creset %s", function(err, gitLog) {
      if (err) {
        console.error("Unable to get diff:", err.stack);
      } else {
        if (! gitLog.trim()) {
          console.log("No new code to deploy.");
        } else {
          console.log(gitLog);
        }
      }
    });
  }
}

function qescape(it){
  return it.replace(/\\/g, "\\\\").replace(/\'/g, "\\'").replace(/\`/g, "\\`");
}

function qqescape(it){
  return it.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
}

function ssh(conf, cmd){
  conf.hosts.forEach(function(host) {
    var args = [
      "-o", "ForwardAgent=yes",
      "-o", "StrictHostKeyChecking=no",
      "-p", conf.port,
      conf.user + "@" + host,
      "bash -c '" + qescape(cmd) + "'"
    ];
    console.log("ssh", args);
    exec("ssh", args);
  });
}

function sshs(conf, cmds){
  ssh(conf, cmds.join(" && "));
}

function inlineEnv(it){
  var k, v, items = [];
  for (k in it) {
    v = it[k] == null ? "" : it[k].toString();
    items.push(k + "=\"" + qqescape(v) + "\"");
  }
  return items.join(" ");
}

function extend(obj, src){
  var own = {}.hasOwnProperty;
  for (var key in src) if (own.call(src, key)) obj[key] = src[key];
  return obj;
}

function exec(cmd, args, opts, cb){
  args = args || [];
  opts = opts || {};
  cb = cb || function() {};
  opts = extend({
    stdio: [process.stdin, process.stdout, process.stderr]
  }, opts);
  var bin = spawn(cmd, args, opts);
  bin.on('exit', cb);
}

function appPath(packageJson, targetName){
  return "/home/" + packageJson.rodent.targets[targetName].ssh.user + "/" + targetName + "/" + packageJson.name;
}

function getDeployDiff(packageJson, targetName, branch, format, cb) {
  var exec = require('child_process').exec;
  var batch = new Batch();
  batch.push(function(cb) {
    var sshConf = packageJson.rodent.targets[targetName].ssh;
    var firstHost = sshConf.hosts[0];
    var destAppPath = appPath(packageJson, targetName);
    var cmd = "ssh " +
      "-o ForwardAgent=yes " +
      "-p " + sshConf.port + " " +
      sshConf.user + "@" + firstHost + " " +
      "'cd " + destAppPath + " && git rev-parse HEAD'";
    exec(cmd, function(err, stdout, stderr) {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        err.cmd = cmd;
        cb(err);
      } else {
        cb(null, stdout.trim());
      }
    });
  });
  batch.push(function(cb) {
    var cmd = "git fetch origin";
    exec(cmd, function(err, stdout, stderr) {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        err.cmd = cmd;
        cb(err);
      } else {
        cb();
      }
    });
  });
  batch.end(function(err, results) {
    if (err) return cb(err);
    var rev = results[0];
    var cmd = "git log --pretty=format:\"" + format + "\" " + rev + "..origin/" + branch;
    exec(cmd, function(err, stdout, stderr) {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        err.cmd = cmd;
        cb(err);
      } else {
        cb(null, stdout.trim());
      }
    });
  });
}

function notifyFlowdock(packageJson, targetName, branch) {
  getDeployDiff(packageJson, targetName, branch, "<li>%h %cd %an <b>%s</b></li>", function(err, gitLog) {
    if (err) {
      console.error("Unable to notify flowdock:", err.stack);
      return;
    }
    var content = "The following is about to be deployed:<ul>" + gitLog + "</ul>";
    var subject = packageJson.name + " deployed to " + targetName + " with branch " + branch;
    var tags    = ["#deploy", "#"+packageJson.name, "#"+targetName];
    var payload = JSON.stringify({
      source: "rodent",
      from_address: "rodent@indabamusic.com",
      project: packageJson.name,
      subject: subject,
      content: content,
      tags: tags
    });
    console.log("subject", subject, "content", content);
    var token = packageJson.rodent.flowdock.token;
    var options = url.parse("https://api.flowdock.com/v1/messages/team_inbox/" + token);
    options.method = "POST";
    options.headers = {
      "Content-Type": "application/json",
      "Content-Length": payload.length,
    };
    var request = https.request(options, function(resp) {
      if (resp.statusCode !== 200) {
        console.error("Posting to flowdock status code " + resp.statusCode);
      }
      resp.on('error', function(err) {
        console.error("Response error posting to flowdock: " + err.stack);
      });
    });
    request.on('error', function(err) {
      console.error("Request error posting to flowdock: " + err.stack);
    });
    request.write(payload);
    request.end();
  });
}

function getDefaultBranch(cb) {
  var exec = require('child_process').exec;
  var cmd = "git rev-parse --abbrev-ref HEAD";
  exec(cmd, function(err, stdout, stderr) {
    if (err) {
      err.stderr = stderr;
      err.stdout = stdout;
      err.cmd = cmd;
      cb(err);
    } else {
      cb(null, stdout.trim());
    }
  });
}
