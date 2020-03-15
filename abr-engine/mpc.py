# FastMPC-like implementation

# Approach #
# This program will run the offline enumeration step to generate a lookup table.
# Option 1. Table is stored in json file in dash.js/ and client retrieves entire table;
#   (+) No lookup latency
#   (-) Memory overload on client if table is large
# Option 2. Table is stored in local web server and client retrieves solution dynamically.
#
# (use Option 1 for now with table size optimization)

# Algorithm #
# 1. State space enumerated by (with binning) -
#   a. throughput
#   b. bufferLevel
#   c. prevBitrate
#   d. averageLatency? (in reward AND state?)
#   e. totalRebufferTime? (in reward AND state?)
#     -- Should add d,e in state because their values affect reward_difference and hence solution
#     -- Unless they give same solution across d,e values (TBC)
#     -- To relook similarity between bufferLevel and totalRebufferTime (TBC)
# 2. For each state -
#   a. Compute the reward difference (gain/loss) of each state-bitrate pair.
#   b. Obtain solution (nextBitrate) as the bitrate with the highest reward gain.
# 3. Aggregate all state-solution into lookup table.
# 4. Optionally, compress lookup table.
#
# (use a-c first)
# a. throughput - Range: 200 - 1200, Bins: 100
# b. bufferLevel - Range: , Bins: 100
# c. prevBitrate - 
# d. 

# Notes #
# Differences w Pensieve's FastMPC implementation -
#   - They used Option 2
#   - We don't have accurate video segment sizes to calc download time of next segment
#   - We use latency in state space
#   - They calculate reward based on 5 future segments
#
#   - Reward calculation: QoE model?
#   - Throughput: Harmonic mean of last 5 throughputs?
#   - Verify their actual state space enumeration
#     -- "S_INFO = 5  # bit_rate, buffer_size, rebuffering_time, bandwidth_measurement, chunk_til_video_end"


import json
import time

# import numpy as np
# import itertools

STATE_INFO = 5