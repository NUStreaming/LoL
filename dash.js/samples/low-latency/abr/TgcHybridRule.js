var TgcHybridRule;

function TgcHybridRuleClass() {

    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
    let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
    let DashMetrics = factory.getSingletonFactoryByName('DashMetrics');
    let StreamController = factory.getSingletonFactoryByName('StreamController');
    let PlaybackController = factory.getSingletonFactoryByName('PlaybackController');
    let MediaPlayerModel = factory.getSingletonFactoryByName('MediaPlayerModel');
    let context = this.context;
    let instance;

    let metricsConstants = {
        ABANDON_LOAD: 'abandonload',
        BUFFER_STATE: 'BufferState'
    }

    const learningController = new LearningAbrController();
    const heuristicController = new HeuristicAbrController();
    let qoeEvaluator = new QoeEvaluator();

    function setup() {
    }

    function getMaxIndex(rulesContext) {
        let switchRequest = SwitchRequest(context).create();

        let metricsModel = MetricsModel(context).getInstance();
        let dashMetrics = DashMetrics(context).getInstance();
        let mediaType = rulesContext.getMediaInfo().type;
        let metrics = metricsModel.getMetricsFor(mediaType, true);

        let streamController = StreamController(context).getInstance();
        let abrController = rulesContext.getAbrController();
        let current = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());

        // Additional stuff for Heuristic rule
        let mediaPlayerModel = MediaPlayerModel(context).getInstance();
        let liveDelay = mediaPlayerModel.getLiveDelay();   

        // Additional stuff
        const mediaInfo = rulesContext.getMediaInfo();
        const bufferStateVO = dashMetrics.getLatestBufferInfoVO(mediaType, true, metricsConstants.BUFFER_STATE);
        const scheduleController = rulesContext.getScheduleController();
        const currentBufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);
        const streamInfo = rulesContext.getStreamInfo();
        const isDynamic = streamInfo && streamInfo.manifestInfo ? streamInfo.manifestInfo.isDynamic : null;
        const throughputHistory = abrController.getThroughputHistory();

        // latency
        //const latency = throughputHistory.getAverageLatency(mediaType)/1000;
        let playbackController = PlaybackController(context).getInstance();
        let latency = playbackController.getCurrentLiveLatency();
        if (!latency) latency = 0;
        const playbackRate = playbackController.getPlaybackRate();
        
        /*
         * decide which throughput value to use
         */
        // const throughput = throughputHistory.getAverageThroughput(mediaType, isDynamic);
        const throughput = throughputHistory.getSafeAverageThroughput(mediaType, isDynamic);
        console.log('[TgcHybridRule] throughput: ' + Math.round(throughput) + 'kbps');

        if (isNaN(throughput) || !bufferStateVO) {
            return switchRequest;
        }

        if (abrController.getAbandonmentStateFor(mediaType) === metricsConstants.ABANDON_LOAD) {
            return switchRequest;
        }

        // QoE parameters
        let bitrateList = mediaInfo.bitrateList;  // [{bandwidth: 200000, width: 640, height: 360}, ...]
        let segmentDuration = rulesContext.getRepresentationInfo().fragmentDuration;
        let minBitrateKbps = bitrateList[0].bandwidth / 1000.0;                         // min bitrate level
        let maxBitrateKbps = bitrateList[bitrateList.length - 1].bandwidth / 1000.0;    // max bitrate level
        for (let i = 0; i < bitrateList.length; i++){
            let b = bitrateList[i].bandwidth / 1000.0;
            if (b > maxBitrateKbps) maxBitrateKbps = b;
            else if (b < minBitrateKbps) minBitrateKbps = b;
        }

        // Learning rule pre-calculations
        let currentBitrate = bitrateList[current].bandwidth;
        let currentBitrateKbps = currentBitrate / 1000.0;
        let httpRequest = dashMetrics.getCurrentHttpRequest(mediaType, true);
        let lastFragmentDownloadTime = (httpRequest.tresponse.getTime() - httpRequest.trequest.getTime())/1000;
        let segmentRebufferTime = lastFragmentDownloadTime>segmentDuration?lastFragmentDownloadTime-segmentDuration:0;
        qoeEvaluator.setupPerSegmentQoe(segmentDuration, maxBitrateKbps, minBitrateKbps);
        qoeEvaluator.logSegmentMetrics(currentBitrateKbps, segmentRebufferTime, latency, playbackRate);
        let currentQoeInfo = qoeEvaluator.getPerSegmentQoe();
        // let normalizedQoEInverse=  currentQoeInfo.totalQoe / currentBitrateKbps;
        let normalizedQoEInverse= currentQoeInfo.totalQoe>0 ? 1 / currentQoeInfo.totalQoe : 1;
        console.log("QoE: ",normalizedQoEInverse);

        /*
         * Select next quality
         */
        // Option A: Use Learning Rule
        let nextQualityLearning = learningController.getNextQuality(mediaInfo,throughput*1000,latency/1000,currentBufferLevel,currentBitrate,normalizedQoEInverse);
        switchRequest.quality = nextQualityLearning;

        // Option B: Use Heuristic Rule
        // let nextQualityHeuristic = heuristicController.getNextQuality(segmentDuration, bitrateList, latency, currentBufferLevel, playbackRate, throughput, liveDelay, player, playbackController, abrController);
        // switchRequest.quality = nextQualityHeuristic;
        // Select next quality - end

        switchRequest.reason = { throughput: throughput, latency: latency };
        switchRequest.priority = SwitchRequest.PRIORITY.STRONG;

        scheduleController.setTimeToLoadDelay(0);

        // logger.debug('[' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
        if (switchRequest.quality!=current){
            console.log('[TgcHybridRule][' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
        }

        return switchRequest;
    }


    instance = {
        getMaxIndex: getMaxIndex
    };

    setup();

    return instance;
}

/* *******************************
*    Main abr logic - Learning
* ******************************* */
class LearningAbrController{

    constructor() {
        this.somBitrateNeurons=null;
        this.bitrateNormalizationFactor=1;
    }

    getSomBitrateNeurons(mediaInfo){
        if (!this.somBitrateNeurons){
            this.somBitrateNeurons = [];
            const bitrateList = mediaInfo.bitrateList;
            let bitrateVector=[];
            bitrateList.forEach(element => {
                bitrateVector.push(element.bandwidth);   
            });
            this.bitrateNormalizationFactor=this.getMagnitude(bitrateVector);
            console.log("throughput normalization factor is "+this.bitrateNormalizationFactor);
            
            for (let i = 0; i < bitrateList.length; i++) {
                let neuron={
                    qualityIndex: i,
                    bitrate: bitrateList[i].bandwidth,
                    state: {
                        // normalize throughputs
                        throughput: bitrateList[i].bandwidth/this.bitrateNormalizationFactor,
                        latency: 0,
                        buffer: 0,
                        previousBitrate: bitrateList[i].bandwidth/this.bitrateNormalizationFactor,
                        QoE: 0
                    }
                }
                this.somBitrateNeurons.push(neuron);
            }
        }
        return this.somBitrateNeurons;
    }

    getMaxThroughput(){
        let maxThroughput=0;
        if (this.somBitrateNeurons){
            for(let i=0;i<this.somBitrateNeurons.length;i++){
                let n=this.somBitrateNeurons[i];
                if (n.state.throughput>maxThroughput){
                    maxThroughput=n.state.throughput;
                }
            }
        } 
        return maxThroughput;
    }

    getMagnitude(w){
        return w
            .map((x) => (x**2)) // square each element
            .reduce((sum, now) => sum + now) // sum 
            ** (1/2) // square root
    }

    getDistance(a, b, w) {
        return a
            .map((x, i) => (w[i] * (x-b[i]) ** 2)) // square the difference*w
            .reduce((sum, now) => sum + now) // sum
            ** (1/2) // square root
    }

    getNeuronDistance(a, b) {
        let aState=[a.state.throughput,a.state.latency, a.state.buffer, a.state.previousBitrate, a.state.QoE];
        let bState=[b.state.throughput,b.state.latency, b.state.buffer, b.state.previousBitrate, b.state.QoE];
        return this.getDistance(aState,bState,[1,1,1,1,1]);
    }

    updateNeurons(winnerNeuron,somElements,x){
        // update all neurons
        for (let i =0; i< somElements.length ; i++) {
            let somNeuron=somElements[i];
            let sigma=0.1;
            let neighbourHood=Math.exp(-1*this.getNeuronDistance(somNeuron,winnerNeuron)/(2*sigma**2));
            this.updateNeuronState(somNeuron,x, neighbourHood);
        }
    }

    updateNeuronState(neuron, x, neighbourHood){
        let state=neuron.state;
        let w=[0.01,0.01,0.01,0.01,0.01]; // learning rate
        // console.log("before update: neuron=",neuron.qualityIndex," throughput=",state.throughput," latency=",state.latency," buffer=",state.buffer)
        state.throughput=state.throughput+(x[0]-state.throughput)*w[0]*neighbourHood;
        state.latency=state.latency+(x[1]-state.latency)*w[1]*neighbourHood;
        state.buffer=state.buffer+(x[2]-state.buffer)*w[2]*neighbourHood;
        state.previousBitrate=state.previousBitrate+(x[3]-state.previousBitrate)*w[3]*neighbourHood;
        state.QoE=state.QoE+(x[4]-state.QoE)*w[4]*neighbourHood;
        console.log("after update: neuron=",neuron.qualityIndex,"throughput=",state.throughput,
                    "latency=",state.latency," buffer=",state.buffer,
                    "previousBitrate=",state.previousBitrate,"QoE=",state.QoE);
    }

    getNextQuality(mediaInfo, throughput, latency, bufferSize, currentBitrate,QoE){
        let somElements=this.getSomBitrateNeurons(mediaInfo);
        // normalize throughput
        throughput=throughput/this.bitrateNormalizationFactor;
        // saturate values higher than 1
        if (throughput>1) throughput=this.getMaxThroughput();
        let currentBitrateNormalized=currentBitrate/this.bitrateNormalizationFactor;
        console.log("getNextQuality called throughput="+throughput+" latency="+latency+" bufferSize="+bufferSize," currentNBitrate=",currentBitrate," QoE=",QoE);

        let minDistance=null;
        let minIndex=null;
        let winnerNeuron=null;
        let currentNeuron=null;
        for (let i =0; i< somElements.length ; i++) {
            let somNeuron=somElements[i];
            if (somNeuron.bitrate==currentBitrate){
                currentNeuron=somNeuron;
            }
            let somNeuronState=somNeuron.state;
            let somData=[somNeuronState.throughput,
                somNeuronState.latency,
                somNeuronState.buffer,
                somNeuronState.previousBitrate,
                somNeuronState.QoE];
            // encourage avaiable throughput bitrates
            let throughputWeight=(somNeuronState.throughput>throughput)?1:0.5;
            let weights=[throughputWeight, 0.4, 0.01, 0.00, 0.4]; // throughput, latency, buffer, previousBitrate, QoE 
            // give 0 as the targetLatency to find the optimum neuron
            // maximizing QoE = minimizing 1/QoE (~ 0
            let distance=this.getDistance(somData,[throughput,0,bufferSize,currentBitrateNormalized,0],weights);
            if (minDistance==null || distance<minDistance){
                minDistance=distance;
                minIndex=somNeuron.qualityIndex;
                winnerNeuron=somNeuron;
            }
            console.log("distance=",distance);
        }

        // update current neuron and the neighbourhood with the calculated QoE
        // will punish current if it is not picked
        this.updateNeurons(currentNeuron,somElements,[throughput,latency,bufferSize,currentBitrateNormalized,QoE]);

        // update bmu and neighnours with targetQoE=0, targetLatency=0
        this.updateNeurons(winnerNeuron,somElements,[throughput,0,bufferSize,currentBitrateNormalized,0]);

        return minIndex;
    }
}


/* *******************************
*    Main abr logic - Heuristic
* ******************************* */
class HeuristicAbrController{

    constructor() {
        // Store past throughputs to calculate harmonic mean for future bandwidth prediction
        this.pastThroughputs = [];
    }

    getNextQuality(segmentDuration, bitrateList, latency, currentBufferLevel, playbackRate, throughput, liveDelay, player, playbackController, abrController) {
        // Update throughput value
        this.pastThroughputs.push(throughput);

        let futureSegmentCount = 5;     // lookahead window
        // let futureSegmentCount = 2;     // lookahead window - small
        let maxReward = -100000000;
        let bestOption = [];
        let bestQoeInfo = {};

        // Qoe stuff
        let qoeEvaluatorTmp = new QoeEvaluator();
        // let segmentDuration = fragmentDuration;
        let minBitrateKbps = bitrateList[0].bandwidth / 1000.0;                         // min bitrate level
        let maxBitrateKbps = bitrateList[bitrateList.length - 1].bandwidth / 1000.0;    // max bitrate level

        // Iterate all possible combinations of bitrates
        // (numBitrates^futureSegmentCount e.g. 3^5 = 243 options)
        let qualityList = [];
        bitrateList.forEach(function (bitrateInfo, index) { qualityList.push(index); });
        let options = this.getPermutations(qualityList, futureSegmentCount);
        // console.log(options.length); // e.g. 243

        // For each option, compute reward and identify option with maxReward
        options.forEach((segments, optionIndex) => {
            // console.log('------------- Option: ' + segments + ' -------------');

            // Set up new (per-segment) Qoe evaluation for each option
            qoeEvaluatorTmp.setupPerSegmentQoe(segmentDuration, maxBitrateKbps, minBitrateKbps);
            // qoeEvaluatorTmp.setupPerChunkQoe((0.5/15), maxBitrateKbps, minBitrateKbps);

            // Set up tmpBuffer to simulate and estimate rebuffer time for each future segment
            let tmpBuffer = currentBufferLevel;
            let currentPlaybackSpeed = playbackRate;
            let currentLatency = 0; // in case latency = NaN, set latency to 0 to ignore this factor
            if (latency) currentLatency = latency;

            // Estimate futureBandwidth as harmonic mean of past X throughput values
            let pastThroughputCount = 5;
            let futureBandwidthKbps = this.calculateHarmonicMean(this.pastThroughputs.slice(pastThroughputCount * -1));
            // console.log('Estimated futureBandwidthKbps: ' + futureBandwidthKbps);

            // For each segment in lookahead window (window size: futureSegmentCount)
            segments.forEach((quality, segmentIndex) => {
                // console.log('### Segment, quality: ' + quality + ' ###');
                // Metrics required for each future segment
                let segmentBitrateKbps = bitrateList[quality].bandwidth / 1000.0;
                let segmentRebufferTime;

                // Estimate futureSegmentSize
                let futureSegmentSizeKbits;

                // R-hat (Naive) //
                futureSegmentSizeKbits = segmentDuration * segmentBitrateKbps;

                // R-hat (Avg of past X segments) //
                // Todo - Assumed same size for all future segments, to update?
                // Todo - Omit anomaly sizes (e.g. those for the init segment)
                // Todo - Estimated segment size should be post-proportioned according to quality level
                // if (!metrics.RequestsQueue || !metrics.RequestsQueue.executedRequests) {
                //     // No previous request data, use naive estimation for segment size
                //     futureSegmentSizeKbits = segmentDuration * segmentBitrateKbps; 
                // }
                // else {
                //     // Estimate futureSegmentSize based on past request data, i.e. previous segments downloaded
                //     let pastSegmentSizeCount = Math.min(5, metrics.RequestsQueue.executedRequests.length);
                //     let pastSegmentSizes = [];
                //     for (let i = pastSegmentSizeCount; i > 0; i--) {
                //         let index = metrics.RequestsQueue.executedRequests.length - i;
                //         let pastRequest = metrics.RequestsQueue.executedRequests[index];
                //         let segmentSizeBytes = pastRequest.bytesTotal;
                //         pastSegmentSizes.push(segmentSizeBytes);
                //     }
                //     futureSegmentSizeKbits = (calculateArithmeticMean(pastSegmentSizes) * 8 / 1000.0);
                //     console.log('pastSegmentSizes:');
                //     console.log(pastSegmentSizes);
                //     console.log('Estimated futureSegmentSize: ' + calculateArithmeticMean(pastSegmentSizes));
                // }
                // console.log('Estimated futureSegmentSizeKbits: ' + futureSegmentSizeKbits);

                // Estimate downloadTime based on futureBandwidth and futureSegmentSize
                let downloadTime = futureSegmentSizeKbits / futureBandwidthKbps;
                // console.log('Estimated downloadTime: ' + downloadTime);
                
                // console.log('-------------------------------------------');
                // console.log('tmpBuffer (bef): ' + tmpBuffer + ', futureBandwidthKbps: ' + futureBandwidthKbps + ', futureSegmentSizeKbits: ' + futureSegmentSizeKbits + ', downloadTime: ' + downloadTime);

                /*
                 * Determine segmentRebufferTime (if any) for this future segment
                 * *** Todo - Buffer behaviour is segment-based, update to chunk-based buffer download and playback ***
                 */
                if (downloadTime > tmpBuffer) { 
                    // Rebuffer case
                    segmentRebufferTime = (downloadTime - tmpBuffer);
                    // Update buffer
                    tmpBuffer = segmentDuration;    // corrected, to correct further (see todo)
                    // Update latency
                    currentLatency += segmentRebufferTime;
                } else {
                    // No rebuffer case
                    segmentRebufferTime = 0;
                    // Update buffer
                    tmpBuffer -= downloadTime;
                    tmpBuffer += segmentDuration;
                }

                // console.log('tmpBuffer (aft): ' + tmpBuffer + ', segmentRebufferTime: ' + segmentRebufferTime);
                // console.log('-------------------------------------------');

                /* 
                 * Determine playbackSpeed after the download of this future segment
                 */
                let liveCatchUpPlaybackRate = player.getSettings().streaming.liveCatchUpPlaybackRate;   // user-specified playbackRate bound
                // let liveDelay = mediaPlayerModel.getLiveDelay();                                        // user-specified latency target
                let liveCatchUpMinDrift = player.getSettings().streaming.liveCatchUpMinDrift            // user-specified min. drift (between latency target and actual latency)
                let playbackStalled = false;    // calc pbSpeed -after- download of future segment, hence there will not be any stall since the segment is assumed to have just completed download
                let futurePlaybackSpeed;

                // Check if to use custom or default playback rate calculations
                let useCustomPlaybackControl, playbackBufferMin, playbackBufferMax;
                if (player.getSettings().streaming.playbackBufferMin && player.getSettings().streaming.playbackBufferMax) {
                    useCustomPlaybackControl = true;
                    playbackBufferMin = player.getSettings().streaming.playbackBufferMin;
                    playbackBufferMax = player.getSettings().streaming.playbackBufferMax;
                } else {
                    useCustomPlaybackControl = false;
                }

                // Check if need to catch up (custom/default methods)
                let needToCatchUp;
                if (useCustomPlaybackControl) {
                    // Custom method
                    needToCatchUp = playbackController.tryNeedToCatchUpCustom(liveCatchUpPlaybackRate, currentLatency, liveDelay, liveCatchUpMinDrift, tmpBuffer, playbackBufferMin, playbackBufferMax);
                } else {
                    // Default method
                    needToCatchUp = playbackController.tryNeedToCatchUp(liveCatchUpPlaybackRate, currentLatency, liveDelay, liveCatchUpMinDrift);
                }

                // If need to catch up, calculate new playback rate (custom/default methods)
                if (needToCatchUp) {
                    let newRate;
                    if (useCustomPlaybackControl) {
                        newRate = playbackController.calculateNewPlaybackRateCustom(liveCatchUpPlaybackRate, currentLatency, liveDelay, liveCatchUpMinDrift, playbackBufferMin, playbackBufferMax, playbackStalled, tmpBuffer, currentPlaybackSpeed).newRate;
                    } else {
                        newRate = playbackController.calculateNewPlaybackRate(liveCatchUpPlaybackRate, currentLatency, liveDelay, playbackStalled, tmpBuffer, currentPlaybackSpeed).newRate;
                    }
                    if (newRate) {
                        futurePlaybackSpeed = newRate;
                    } else {
                        // E.g. don't change playbackrate for small variations
                        futurePlaybackSpeed = currentPlaybackSpeed;
                    }
                }
                else {
                    // If no need to catch up, run equivalent to playbackController.stopPlaybackCatchUp()
                    futurePlaybackSpeed = 1.0;
                }
                // console.log('futurePlaybackSpeed: ' + futurePlaybackSpeed);

                /*
                 * Determine latency after the download (and playback) of this future segment
                 * Note: Assume the next segment is played uniformly with the playback speed calculated at the start of the segment
                 */
                let catchupDuration = segmentDuration - (segmentDuration / futurePlaybackSpeed);
                let futureLatency = currentLatency - catchupDuration;
                // console.log('currentLatency: ' + currentLatency + ', catchupDuration: ' + catchupDuration + ', futureLatency: ' + futureLatency);

                qoeEvaluatorTmp.logSegmentMetrics(segmentBitrateKbps, segmentRebufferTime, futureLatency, futurePlaybackSpeed);

                // Update values for next segment loop
                currentLatency = futureLatency;
                currentPlaybackSpeed = futurePlaybackSpeed;
            });

            // Calculate potential reward for this option
            let currentQoeInfo = qoeEvaluatorTmp.getPerSegmentQoe();
            // console.log('### QoeInfo ###');
            // console.log(currentQoeInfo);

            let reward = currentQoeInfo.totalQoe;
            if (reward > maxReward) {
                maxReward = reward;
                bestOption = options[optionIndex];
                bestQoeInfo = currentQoeInfo;
            }
        });

        // For debugging
        console.log('### bestOption: ' + bestOption + ' ###');
        console.log('### bestQoeInfo ###');
        console.log(bestQoeInfo);

        let nextQuality;
        if (bestOption.length < 1) { 
            // If no bestOption was found, use quality best matched to throughput
            nextQuality = abrController.getQualityForBitrate(mediaInfo, throughput, latency);
        } else {
            nextQuality = bestOption[0];
        }

        return nextQuality;
    }

    getPermutations(list, length) {
        // Copy initial values as arrays
        var perm = list.map(function(val) {
            return [val];
        });
        // Our permutation generator
        var generate = function(perm, length, currLen) {
            // Reached desired length
            if (currLen === length) {
                return perm;
            }
            // For each existing permutation
            for (var i = 0, len = perm.length; i < len; i++) {
                var currPerm = perm.shift();
                // Create new permutation
                for (var k = 0; k < list.length; k++) {
                    perm.push(currPerm.concat(list[k]));
                }
            }
            // Recurse
            return generate(perm, length, currLen + 1);
        };
        // Start with size 1 because of initial values
        return generate(perm, length, 1);
    }

    calculateHarmonicMean(arrOfValues) {
        let sumOfReciprocals = 0;
        arrOfValues.forEach(function (value, index) {
            sumOfReciprocals += (1.0 / value);
        });
        // Return harmonic mean
        return (1.0 / (sumOfReciprocals / arrOfValues.length));
    }

}

TgcHybridRuleClass.__dashjs_factory_name = 'TgcHybridRule';
TgcHybridRule = dashjs.FactoryMaker.getClassFactory(TgcHybridRuleClass);