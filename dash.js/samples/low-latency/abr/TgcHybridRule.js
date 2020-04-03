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

        // Dash controllers
        let streamController = StreamController(context).getInstance();
        let playbackController = PlaybackController(context).getInstance();
        let abrController = rulesContext.getAbrController();

        // Additional stuff for Heuristic rule
        let mediaPlayerModel = MediaPlayerModel(context).getInstance();
        let liveDelay = mediaPlayerModel.getLiveDelay();   

        // Additional stuff for Learning rule
        let current = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());

        // Additional stuff for both
        const mediaInfo = rulesContext.getMediaInfo();
        const bufferStateVO = dashMetrics.getLatestBufferInfoVO(mediaType, true, metricsConstants.BUFFER_STATE);
        const scheduleController = rulesContext.getScheduleController();
        const currentBufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);
        const streamInfo = rulesContext.getStreamInfo();
        const isDynamic = streamInfo && streamInfo.manifestInfo ? streamInfo.manifestInfo.isDynamic : null;

        let latency = playbackController.getCurrentLiveLatency();
        if (!latency) latency = 0;
        const playbackRate = playbackController.getPlaybackRate();
        
        /*
         * Throughput
         */
        const throughputHistory = abrController.getThroughputHistory();
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
        for (let i = 0; i < bitrateList.length; i++) {   // in case bitrateList is not sorted as expeected
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

TgcHybridRuleClass.__dashjs_factory_name = 'TgcHybridRule';
TgcHybridRule = dashjs.FactoryMaker.getClassFactory(TgcHybridRuleClass);