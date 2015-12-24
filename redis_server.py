#!/usr/bin/python
import sys
import inspect
import subprocess
from os.path import join
from threading import Thread

from redis_wrapper import RedisWrapper
from server_conf import (
    TEAM_LIST,
)

def start_redis_server_helper(
    stdin=None,
    stdout=None,
    stderr=None,
):
    # REDIS SERVER SETUP
    redis_cmd = "redis-server local_redis.conf"
    subprocess.call(redis_cmd, stdin=stdin, stdout=stdout, stderr=stderr, shell=True)


def initialize_redis_server():
    redis_con = RedisWrapper()

    # Delete any keys still on the server
    redis_con.redis_con.flushall()

    redis_con.set_is_question_listening(0)
    redis_con.set_is_buzzer_listening(0)

    for team in TEAM_LIST:
        redis_con.set_score(team,0)
        redis_con.set_buzzer(team,0)


def start_redis_server(
    stdin=None,
    stdout=sys.stdout,
    stderr=sys.stderr,
):
    
    initilize_thread = Thread(target=initialize_redis_server, args = () )
    initilize_thread.start()

    print "Starting Redis Server"
    start_redis_server_helper(
        stdin=stdin, 
        stdout=stdout, 
        stderr=stderr,
    )

if __name__ == "__main__":
    start_redis_server()