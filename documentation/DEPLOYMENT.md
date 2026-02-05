
# Instructions 

To get started with running the code in the server, do the following:


## Deployment

Clone the project

```bash
  git clone https://github.com/Ministry-of-Technology-AU/Sports-Inventory.git
```

Go to the project directory

```bash
  cd sports-inventory
```

Install dependencies

```bash
  npm install 
```
and
```bash
  npm install -g nodemon # or using yarn: yarn global add nodemon
```

Start the app

```bash
  nodemon src/app.js
```

## To manage the app using PM2

```bash
  pm2 start npm --name "sports-inventory" -- start
```


