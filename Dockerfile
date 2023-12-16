FROM python:3.12

WORKDIR /app

COPY install_redis.sh .

RUN /app/install_redis.sh
RUN pip install redis


COPY . /app

CMD /bin/bash run.sh
