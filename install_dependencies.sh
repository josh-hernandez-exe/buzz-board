
# For redis
sudo apt-get install tcl8.5

# http://redis.io/topics/quickstart
wget http://download.redis.io/redis-stable.tar.gz
tar xvzf redis-stable.tar.gz
cd redis-stable
make
cd src
make test

sudo pip install redis