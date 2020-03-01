npm install
npm run test            // default test: 2.5mins (10s stabilization + 2.5mins recording)
npm run test:custom     // shorter test: 20s (10s stabilization + 10s recording)

On completing test run, results found in ./results folder ordered by test run's timestamp

Note!
Test run program `dash-test-custom/run.js` here uses `samples/low-latency-custom/index.html` instead of the standard `low-latency` client provided by TGC
- Reason: customized metrics collection
- Warning: should note changes to low-latency client and propagate to low-latency-custom