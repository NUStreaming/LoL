var TgcLearningRule;

function TgcLearningRuleClass() {

    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
    let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
    let DashMetrics = factory.getSingletonFactoryByName('DashMetrics');
    let StreamController = factory.getSingletonFactoryByName('StreamController');
    let context = this.context;
    let instance;

    let metricsConstants = {
        ABANDON_LOAD: 'abandonload',
        BUFFER_STATE: 'BufferState'
    }

    const somController = new SOMAbrController();

    function setup() {
    }

    function getMaxIndex(rulesContext) {
        let switchRequest = SwitchRequest(context).create();

        let metricsModel = MetricsModel(context).getInstance();
        let dashMetrics = DashMetrics(context).getInstance();
        let mediaType = rulesContext.getMediaInfo().type;
        let metrics = metricsModel.getMetricsFor(mediaType, true);

        // Get current bitrate
        let streamController = StreamController(context).getInstance();
        let abrController = rulesContext.getAbrController();
        let current = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());

        // Additional stuff
        const mediaInfo = rulesContext.getMediaInfo();
        const bufferStateVO = dashMetrics.getLatestBufferInfoVO(mediaType, true, metricsConstants.BUFFER_STATE);
        const scheduleController = rulesContext.getScheduleController();
        const currentBufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);
        const streamInfo = rulesContext.getStreamInfo();
        const isDynamic = streamInfo && streamInfo.manifestInfo ? streamInfo.manifestInfo.isDynamic : null;
        const throughputHistory = abrController.getThroughputHistory();
        const latency = throughputHistory.getAverageLatency(mediaType);
        
        /*
         * decide which throughput value to use
         */
        // const throughput = throughputHistory.getAverageThroughput(mediaType, isDynamic);
        const throughput = throughputHistory.getSafeAverageThroughput(mediaType, isDynamic);
        console.log('[TgcLearningRule] throughput: ' + Math.round(throughput) + 'kbps');

        if (isNaN(throughput) || !bufferStateVO) {
            return switchRequest;
        }

        if (abrController.getAbandonmentStateFor(mediaType) === metricsConstants.ABANDON_LOAD) {
            return switchRequest;
        }

        // To Mehmet: Note that these 2 buffer-related values differ
        // Current buffer length is stored in currentBufferLevel
        // Check console log to verify
        console.log('bufferStateVO.target: ' + bufferStateVO.target + ', currentBufferLevel: ' + currentBufferLevel);

        // select next quality using SOM
        switchRequest.quality = somController.getQualityUsingSom(mediaInfo,throughput*1000,latency,bufferStateVO.target);
        switchRequest.reason = { throughput: throughput, latency: latency};
        switchRequest.priority = SwitchRequest.PRIORITY.STRONG;

        scheduleController.setTimeToLoadDelay(0);

        // logger.debug('[' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
        console.log('[TgcLearningRule][' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');

        return switchRequest;
    }


    instance = {
        getMaxIndex: getMaxIndex
    };

    setup();

    return instance;
}

/* ************************
*    Main abr logic
* ************************ */
class SOMAbrController{

    constructor() {
        this.somBitrateNeurons=null;
    }

    getSomBitrateNeurons(mediaInfo){
        if (!this.somBitrateNeurons){
            this.somBitrateNeurons = [];
            const bitrateList = mediaInfo.bitrateList;
            for (let i = 0; i < bitrateList.length; i++) {
                let neuron={
                    qualityIndex: i,
                    bitrate: bitrateList[i].bandwidth,
                    state: {
                        throughput: bitrateList[i].bandwidth,
                        latency: 0,
                        buffer: 0
                    }
                }
                this.somBitrateNeurons.push(neuron);
            }
        }
        return this.somBitrateNeurons;
    }

    getDistance(a, b, w) {
        return a
            .map((x, i) => (w[i]*(x-b[i])) ** 2) // square the difference*w
            .reduce((sum, now) => sum + now) // sum
            ** (1/2) // square root
    }

    updateNeuronState(neuron, x){
        let state=neuron.state;
        let w=0.1; // learning rate
        state.throughput=state.throughput+(x[0]-state.throughput)*w
        state.latency=state.latency+(x[1]-state.latency)*w
        state.buffer=state.buffer+(x[2]-state.buffer)*w
    }

    getQualityUsingSom(mediaInfo, throughput, latency, bufferSize){
        let somElements=this.getSomBitrateNeurons(mediaInfo);
        let minDistance=null;
        let minIndex=null;
        let neuronTobeUpdated=null;
        for (let i =0; i< somElements.length ; i++) {
            let somNeuron=somElements[i];
            let somNeuronState=somNeuron.state;
            let somData=[somNeuronState.throughput,somNeuronState.latency,somNeuronState.buffer];
            let distance=this.getDistance(somData,[throughput,latency,bufferSize],[1,1,1]);
            if (minDistance==null || distance<minDistance){
                minDistance=distance;
                minIndex=somNeuron.qualityIndex;
                neuronTobeUpdated=somNeuron;
            }
            console.log("distance=",distance);
        }
        if (neuronTobeUpdated!=null){
            this.updateNeuronState(neuronTobeUpdated,[throughput,latency,bufferSize]);
        }
        return minIndex;
    }
}

TgcLearningRuleClass.__dashjs_factory_name = 'TgcLearningRule';
TgcLearningRule = dashjs.FactoryMaker.getClassFactory(TgcLearningRuleClass);