#!/usr/bin/python
import time
import json
import sys
import os

from BaseHTTPServer import HTTPServer
from SocketServer import ThreadingMixIn
from SimpleHTTPServer import SimpleHTTPRequestHandler

from server_conf import (
    HTTP_HOST_NAME,
    HTTP_PORT_NUMBER,
    TEAM_LIST,
)
from redis_wrapper import (
    RedisWrapper,
    BUZZER_NOT_PRESSED,
    BUZZER_PRESSED,
    BUZZER_PRESSED_FAILED,
)

if __debug__:
    import pdb

redis_con = RedisWrapper()

OP_HISTORY = []
OP_FUTURE = []
scoreboard_state = {}

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """
    Handle requests in a separate thread.

    *******************************************
    Note: that ThreadingMixIn must come before HTTPServer
    in the superclass list or this won't work as intended.
    *******************************************
    """


class MyHandler(SimpleHTTPRequestHandler):

    def do_GET(self):
        did_handel_request = False

        if self.path == "/admin":
           self.send_response(301)
           self.send_header('Location','/admin.html')
           self.end_headers()
           did_handel_request = True

        elif self.path == "/scoreboard":
           self.send_response(301)
           self.send_header('Location','/scoreboard.html')
           self.end_headers()
           did_handel_request = True

        elif self.path == "/scoreboard/state":
           self.send_response(200)
           self.send_header('content-type','json')
           self.end_headers()
           self.wfile.write(json.dumps(scoreboard_state))
           did_handel_request = True

        if not did_handel_request:
            SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        self.send_response(200)

        data_string = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(data_string)
        print data_string

        if data["userType"] == "player":

            handle_player_post_request(data)

        elif data["userType"] == "admin":

            handle_admin_post_request(data)

        else:
            print "Not excepted userType"

HandlerClass = MyHandler


def handle_player_post_request(data):
    if "team" not in data:
        # Ignore
        if __debug__:
            print "There is no team field in the data passed in."

    if data["team"] not in TEAM_LIST:
        # Ignore
        if __debug__:
            print "This is not a valid team."

    elif not redis_con.get_is_question_listening():
        # Question is not active
        # Ignore
        if __debug__:
            print "Question is not active"

    elif not redis_con.get_is_buzzer_listening():
        if __debug__:
            print "Someone else has already buzzed in."

    else:
        team_buzzer_status = redis_con.get_buzzer(data["team"])

        if team_buzzer_status == BUZZER_NOT_PRESSED:
            # No one has buzzed in yet, including you
            if __debug__:
                print "You have buzzed in!"
            redis_con.set_is_buzzer_listening(0)
            redis_con.set_buzzer(data["team"], BUZZER_PRESSED)
            update_board_state()

        elif __debug__:

            if team_buzzer_status == BUZZER_PRESSED:
                if __debug__:
                    print "You have already sucessfully buzzed in."
            elif team_buzzer_status == BUZZER_PRESSED_FAILED:
                if __debug__:
                    print "You had your chance."

            else:
                print "THIS SHOULD NEVER HAPPEN!"

def handle_admin_post_request(data):
    try:
        data["value"] = int(data["value"])
    except:
        data["value"] = 0

    if data["operation"] == "questionListening":

        if data["value"] == 1:
            # We want to start listening
            # Reinitialize the state
            for team in TEAM_LIST:
                redis_con.set_buzzer(team, 0)

            redis_con.set_is_buzzer_listening(1)

        redis_con.set_is_question_listening(data["value"])

    elif data["operation"] == "keepListening":
        if redis_con.get_is_question_listening():

            for team in TEAM_LIST:
                if redis_con.get_buzzer(team) == BUZZER_PRESSED:
                    redis_con.set_buzzer(team, BUZZER_PRESSED_FAILED)

            # Only begin listening after resetting the buzzer states for the teams
            redis_con.set_is_buzzer_listening(1)

    elif data["operation"] == "resetBuzzer":
        if redis_con.get_is_question_listening():

            for team in TEAM_LIST:
                redis_con.set_buzzer(team, 0)

            # Only begin listening after resetting the buzzer states for the teams
            redis_con.set_is_buzzer_listening(1)

    elif data["operation"] in ["add","sub","set"]:
        handle_score_opperation(
            team=data["team"],
            operation=data["operation"],
            value=data["value"],
        )

    elif data["operation"] == "undo":
        handle_undo()

    elif data["operation"] == "redo" :
        handle_redo()

    else:
        pass

    update_board_state()


def _handle_score_opperation_helper(team,operation,value):

    if operation == "add":
        redis_con.increment_score(team, value)

    elif operation == "sub":
        redis_con.increment_score(team, -value)

    elif operation == "set":
        raise Exception()


def handle_score_opperation(team,operation,value):

    if operation == "set":
        old_score = redis_con.get_score(team)
        diff = value - old_score
        new_operation = "add" if diff >= 0 else "sub"

        return handle_score_opperation(team, new_operation, abs(diff))

    _handle_score_opperation_helper(team,operation, value)

    OP_HISTORY.append( (team,operation,value) )

    while OP_FUTURE:
        OP_FUTURE.pop()


def handle_undo():

    team,operation,value = OP_HISTORY.pop()

    OP_FUTURE.append((team,operation,value))

    if operation in ["add","sub"]:
        _handle_score_opperation_helper(team,operation, -value)

    else:
        raise Exception()

def handle_redo():
    if len(OP_FUTURE)>0:
        team,operation,value = OP_FUTURE.pop()
        OP_HISTORY.append((team,operation,value))
        _handle_score_opperation_helper(team,operation, value)


def update_board_state():
    global scoreboard_state
    state = {}

    state["question"] = int(redis_con.get_is_question_listening())

    for team in TEAM_LIST:
        state[team] = {}
        state[team]["score"] = redis_con.get_score(team)
        state[team]["buzzer"] = int(redis_con.get_buzzer(team))

    scoreboard_state = state

def create_team_list_json():
    team_list_json_str = json.dumps(TEAM_LIST)
    with open("team_list.json","w") as ff:
        print>>ff,team_list_json_str

def start_http_server():
    # HTTP SERVER SETUP

    os.chdir("web/")

    create_team_list_json()
    update_board_state()

    HandlerClass.protocol_version = "HTTP/1.0"

    httpd = ThreadedHTTPServer(
        server_address=(HTTP_HOST_NAME,HTTP_PORT_NUMBER), 
        RequestHandlerClass=HandlerClass,
    )


    print time.asctime(), "Server Starts - %s:%s" % (HTTP_HOST_NAME, HTTP_PORT_NUMBER)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()
    print ""
    print time.asctime(), "Server Stops - %s:%s" % (HTTP_HOST_NAME, HTTP_PORT_NUMBER)

if __name__ == "__main__":
	start_http_server()
