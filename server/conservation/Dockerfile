FROM rust:1.98.1-trixie@sha256:a8a5f0a1e5fe7dfe1d352591e4a1c7dd2c08fd70475cae872cf3458ba0df0546 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    clang libclang-dev cmake pkg-config libssl-dev liburing-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY source/ ./
ENV CARGO_BUILD_JOBS=2 CONTINUWUITY_VERSION_EXTRA=046074bbc-sion-conservation-v1
RUN --mount=type=cache,id=sion-conservation-target,target=/source/target \
    --mount=type=cache,id=sion-conservation-cargo,target=/usr/local/cargo/registry \
    --mount=type=cache,id=sion-conservation-git,target=/usr/local/cargo/git \
    cargo build --locked --release -p conduwuit \
    && mkdir /artifact && cp target/release/conduwuit /artifact/conduwuit \
    && cd /artifact && sha256sum conduwuit > SHA256SUMS

FROM build AS verification
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
COPY smoke.py /smoke.py
COPY test_clock.c /test_clock.c
RUN gcc -Wall -Wextra -shared -fPIC /test_clock.c -ldl -o /sion-test-clock.so \
    && python3 /smoke.py --binary /artifact/conduwuit --cleanup --clock-library /sion-test-clock.so

FROM scratch AS artifact
COPY --from=verification /artifact/ /
