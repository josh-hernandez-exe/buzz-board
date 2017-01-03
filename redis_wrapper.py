import redis
import time

REDIS_HOST_NAME = "localhost"
REDIS_UNIX_SOCET = "/tmp/redis.sock"

REDIS_SCORE_FORMAT = "score=%s"
REDIS_BUZZER_FORMAT = "buzzer=%s"
REDIS_LISTENING_FORMAT = "listening=%s"

BUZZER_NOT_PRESSED = 0
BUZZER_PRESSED = 1
BUZZER_PRESSED_FAILED = 2

class RedisWrapper(object):
    def __init__(self,max_trys=500):

        redis_con = None

        for index in range(max_trys):
            if redis_con is not None:
                break

            try:
                redis_con = redis.StrictRedis(
                    host=REDIS_HOST_NAME,
                    unix_socket_path=REDIS_UNIX_SOCET,
                    db=0
                )
            except redis.exceptions.ConnectionError:
                redis_con = None

        able_to_ping = False
        for index in range(max_trys):
            if able_to_ping:
                break

            try:
                able_to_ping = redis_con.ping()

            except redis.exceptions.ConnectionError:
                pass

            time.sleep(1) # Play nice with the server

        self._redis_con = redis_con

    @property
    def redis_con(self):
        return self._redis_con   


    def _get_helper(self,key,_format):
        formated_key = _format%key
        if not self.redis_con.exists(formated_key):
            return None

        return self.redis_con.get(formated_key)

    def _set_helper(self,key,value,_format):
        formated_key = _format%key
        return self.redis_con.set(formated_key,value)

    def _exist_helper(self,key,_format):
        formated_key = _format%key
        return self.redis_con.exists(formated_key,value)

    def _get_bool_helper(self,key,_format):
        return bool( self._get_int_helper(key,_format) )

    def _get_int_helper(self,key,_format):
        value = self._get_helper(key,_format)
        return int(value) if value is not None else 0

    def _set_int_helper(self,key,value,_format):
        is_int(value,raise_exception=True)
        return self._set_helper(key,int(value),_format)



    # Score Related Functions

    def get_score(self,team):
        return self._get_int_helper(team, REDIS_SCORE_FORMAT)

    def set_score(self,team,value):
        return self._set_int_helper(team, value, REDIS_SCORE_FORMAT)

    def increment_score(self,team,value):
        old_score = self.get_score(team)
        return self.set_score(team, old_score+value)


    # Buzzer Related Functions

    def get_buzzer(self,team):
        return self._get_int_helper(team, REDIS_BUZZER_FORMAT)

    def set_buzzer(self,team,value):
        return self._set_int_helper(team, value, REDIS_BUZZER_FORMAT)


    # Question Listening Related Functions

    def set_is_buzzer_listening(self,value):
        return self._set_int_helper("buzzer", value, REDIS_LISTENING_FORMAT)

    def get_is_buzzer_listening(self):
        return self._get_bool_helper("buzzer", REDIS_LISTENING_FORMAT)

    def set_is_question_listening(self,value):
        return self._set_int_helper("question", value, REDIS_LISTENING_FORMAT)

    def get_is_question_listening(self):
        return self._get_bool_helper("question", REDIS_LISTENING_FORMAT)



def is_int(value,raise_exception=False):
    try:
        int(value)
    except Exception:
        if raise_exception:
            error_message = "This value cannot be casted to an int: %s"%value
            raise ValueError(error_message)

        return False
    else:
        return True



if __name__ == "__main__":
    r_server = RedisWrapper()
