
# For redis
sudo apt-get install tcl8.5

# http://redis.io/topics/quickstart
wget http://download.redis.io/redis-stable.tar.gz
tar xvzf redis-stable.tar.gz
cd redis-stable
make
make install
cd src
make test

sudo pip install redis

# web client dependencies

wget https://code.jquery.com/jquery-2.1.1.min.js --output-document=./web/js/third-party/jquery-2.1.1.min.js
wget https://cdnjs.cloudflare.com/ajax/libs/materialize/0.97.3/js/materialize.min.js --output-document=./web/js/third-party/materialize.min.js
