#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

cd $SCRIPT_DIR

python redis_server.py &
python http_server.py &


# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?
