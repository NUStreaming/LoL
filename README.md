If you have any questions, or would like help setting up the test env, please file an issue or reach out to 2020-lll-challenge@acmmmsys.org

# Assets for Twitch's ACM MMSys 2020 Grand Challenge

This repo contains assets for Twitch's ACM MMSys 2020 Grand Challenge, [Adaptation Algorithm for Near-Second Latency](https://2020.acmmmsys.org/lll_challenge.php). It contains everything you need to build and test low-latency ABR algorithms locally.

# Submission and Evaluation
See [this document](evaluation.md) for instructions on how to submit your work, and how it will be evaluated.


# What's in the Box

- A fork of [Dash.js v3.0.1](https://github.com/Dash-Industry-Forum/dash.js), modified to pre-request low-latency segments
- A low-latency [DASH server](https://gitlab.com/fflabs/dash_server), setup and configured for ease of use
- ffmpeg for MacOS built from the dashll branch (https://gitlab.com/fflabs/ffmpeg/tree/dashll) at commit 0fe5e13b9b76e7fac0c2dac1f4fdc8b37c007d13


# Requirements
- MacOS
    - If you're using another operating system, don't worry. You'll just have to build ffmpeg from source, and change a few variables. See that README in dash-ll-server/ for instructions.
- python3
- node.js v12+
- Chrome (latest, v80 at the moment)


# How to use

- Install each project locally by following their enclosed README
- Start Dash.js by running `grunt dev` in the `dash.js` folder
- In a separate terminal window, start the ingest server by running `bash run_server.sh` in the `dash-ll-server` folder

From here you have a few options:
### Executing test runs
This option should be used for validating your solution against our network patterns.

- Execute the following command: `npm run test`
- When the test run has concluded, end the program in the same shell (cmd+c on mac, ctrl+c on windows)
- Tests results are written to the results/ folder

This will kick off an automated test, during which network conditions will be emulated. At the end of the run the statistics will be logged. We'll be adding new test runs throughout the challenge.

**Reminder:** The python server (`bash run_server.sh` step above) and the dash server (`grunt dev` step above) must be running!


### Configuring Test Runs
There are several network profiles which can be tested against. In order to set a profile, change the `network_profile` option within the `config` block in the `package.json`. The following profiles are currently available:

    - PROFILE_CASCADE
    - PROFILE_INTRA_CASCADE
    - PROFILE_SPIKE
    - PROFILE_SLOW_JITTERS
    - PROFILE_FAST_JITTERS

You may also add and run your own configs. For examples on how to do so, please use the pattern found in `network-patterns.js`.

If your computer isn't fast enough to run the normal FFMpeg ladder, change the `ffmpeg_profile` option in the config block to `PROFILE_FAST`. Note that this uses a different set of network profiles.

## Local development
This option should be used for developing a solution.

- In a new terminal, naviagte into the `dash-ll-server` folder
- Execute `bash run_gen.sh`
- The DASH server should be running and available at http://localhost:9001/live/live.mpd
    - If your computer isn't fast enough to run the default profile, try `bash run_gen.sh PROFILE_FAST`
    - Note! If you've reached the end of the stream (~10 minutes), you'll have to restart `run_gen.sh`
- Once each is running, navigate to http://localhost:3000/samples/low-latency/index.html to see the stream play out

To verify everything is working correctly, check that playback of Big Buck Bunny is functioning at the above link. The player should be able to stream smoothly configured down to 0.5s of latency

## Local Network Emulation
See https://developers.google.com/web/tools/chrome-devtools/network#throttle on how to simulate network conditions in Chrome. This will be useful for testing your work.

## Network Profiles
- There are currently two network profiles available, one for the `PROFILE_FAST` environment and one for `PROFILE_NORMAL`.

# Help! Things aren't working
Below is a compilation of common issues & how to fix them. If you don't see your problem here, please file an issue and we'll do our best to help.

```
Access to fetch at 'http://localhost:9001/live/chunk-stream2-00167.m4s' from origin 'http://localhost:3000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource. If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.
```

If you see an error like this, it means that ffmpeg is struggling to encode quickly enough. Try the following:
- Allow ffmpeg to warm up for a few seconds. You can monitor the speed by checking the logs of `run_gen.sh`:
`frame=  202 fps= 28 q=30.0 q=25.0 q=26.0 size=N/A time=00:00:06.70 bitrate=N/A dup=6 drop=0 speed=0.943x`
Wait until the speed is above .9 before attempting to test.
- Close other programs to reduce the CPU load
- Run this setup on a faster computer
- If you're still having the above issue, please open an issue.
- Try running with the `PROFILE_FAST` option. See the "How to use" section above for more instruction.

```
$ node run.js
Error: Failed to launch the browser process! spawn /Applications/Google Chrome.app/Contents/MacOS/Google Chrome ENOENT
```
You need to change your Chrome executable path in `run.js`:

`const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";`

Change the path to the location of your Chrome executable.

# Important Notes

For the purpose of this challenge, the following cannot be changed:

- The segment duration
- The segment chunk size
- The prerequest behavior

If you'd like to discuss changing any of the above, please open an issue.

## Important links
- Local Dash.js low-latency page: http://localhost:3000/samples/low-latency/index.html
- Local stream URL http://localhost:9001/live/live.mpd
- http://streaming.university/ACTE/ Currently the most accurate way to do bandwidth estimation with chunked-transfer encoding. A good place to start.

## Kudos
Big thanks to Will Law, the Dash.js team, and the video-dev slack for their help in setting up this low-latency development environment. Kudos to FFLabs for creating the dash server and ffmpeg script.

