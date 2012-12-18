#!/usr/bin/env node

var optimist = require('optimist')
  , spawn = require('child_process').spawn
  , path = require('path')

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
  deploy: {
    fn: deploy,
    info: "<target> [--branch branch] - deploy code (default master)",
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
  var packageJson = require(path.join(process.cwd(), "package.json"));
  var optParser = optimist
    .demand(1)
    .usage(genUsage())
  var cmd = optParser.argv._[0];
  var task = tasks[cmd];
  if (task) {
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
  for (name in packageJson.squirrel.targets) {
    target = packageJson.squirrel.targets[name];
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
  var targetConf = packageJson.squirrel.targets[targetName]
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
  var targetConf = packageJson.squirrel.targets[targetName]
  var env = inlineEnv(targetConf.env);
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    env + " authbind --deep npm start"
  ]);
}
function stop(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.squirrel.targets[targetName]
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    "npm stop"
  ]);
}
function deploy(optParser, packageJson) {
  var argv = optParser
    .demand(1)
    .default('branch', 'master')
    .argv;
  var targetName = argv._[1]
  var targetConf = packageJson.squirrel.targets[targetName]
  var env = inlineEnv(targetConf.env);
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    "git fetch",
    "git checkout origin/" + argv.branch,
    "git submodule update",
    "npm prune",
    "npm install",
    env + " npm run deploy",
  ]);
}
function abort(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.squirrel.targets[targetName]
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    "npm run deploy-abort"
  ]);
}
function monitor(optParser, packageJson) {
  var argv = optParser.demand(1).argv;
  var targetName = argv._[1]
  var targetConf = packageJson.squirrel.targets[targetName]
  var tailCmd = packageJson.squirrel.commands.monitor || "tail -f *.log";
  sshs(targetConf.ssh, [
    "cd " + appPath(packageJson, targetName),
    tailCmd
  ]);
}

function qescape(it){
  return it.replace(/\\/, "\\\\").replace(/\'/, "\\'");
}

function qqescape(it){
  return it.replace(/\\/, "\\\\").replace(/\"/, '\\"');
}

function ssh(conf, cmd){
  conf.hosts.forEach(function(host) {
    var args = [
      "-o", "ForwardAgent=yes",
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
    v = it[k];
    items.push(k + "=\"" + qqescape(v.toString()) + "\"");
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
  return "/home/" + packageJson.squirrel.targets[targetName].ssh.user + "/" + targetName + "/" + packageJson.name;
}
