# rodent

npm package to deploy node.js apps.

![](http://static.fjcdn.com/pictures/epic_c3c08f_738620.jpg)

## Usage

1. Install globally with npm:

  ```
  sudo npm install -g https://github.com/indabamusic/rodent/archive/0.0.0.tar.gz
  ```

2. Make sure these properties exist in your `package.json`:

  ```json
  {
    "name": "your-app-name",
    "repository": {
      "url": "https://github.com/indabamusic/your-repo.git",
      "type": "git"
    },
    "scripts": {
      "deploy": "naught deploy",
      "deploy-abort": "naught deploy-abort"
    },
    "rodent": {
      "commands": {
        "monitor": "tail -f *.log"
      },
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
  }
  ```

3. Install and configure the prerequisites on your targets:

  * [authbind](http://www.debian-administration.org/articles/386)
  * node.js v0.8.x
  * git

4. Use the CLI to deploy your code like a boss:

  ```
  rodent --help
  ```

