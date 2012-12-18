# squirrel

Indaba-specific npm package to deploy our node.js apps.

![](http://static.fjcdn.com/pictures/epic_c3c08f_738620.jpg)

## Usage

1. Install globally with npm:

```
npm install -g https://github.com/indabamusic/squirrel/tarball/0.0.0
```

2. Create a file in the root of your project called `remotes.json`:

```json
{
  "targets": {
    "staging": {
      "ssh": {
        "user": "deploy",
        "port": 22,
        "hosts": [
          "ec2-999-73-48-147.compute-1.amazonaws.com"
        ]
      },
      "env": {
        "HOST": "0.0.0.0",
        "PORT": 80,
        "NODE_ENV": "production"
      }
    },
    "production": {
      "ssh": {
        "user": "deploy",
        "port": 22,
        "hosts": [
          "ec2-999-73-48-147.compute-1.amazonaws.com"
        ]
      },
      "env": {
        "HOST": "0.0.0.0",
        "PORT": 80,
        "NODE_ENV": "production"
      }
    }
  }
}
```

3. Use the CLI to deploy your code like a boss:

```
squirrel --help
```
