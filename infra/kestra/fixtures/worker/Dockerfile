FROM postgres:17-alpine

COPY entrypoint.sh /usr/local/bin/fixture-worker
RUN chmod 0555 /usr/local/bin/fixture-worker
ENTRYPOINT ["/usr/local/bin/fixture-worker"]
