// var TgcLearningRule;

// function TgcLearningRuleClass() {

//     let factory = dashjs.FactoryMaker;
//     let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
//     let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
//     let DashMetrics = factory.getSingletonFactoryByName('DashMetrics');
//     let StreamController = factory.getSingletonFactoryByName('StreamController');
//     let PlaybackController = factory.getSingletonFactoryByName('PlaybackController');
//     let context = this.context;
//     let instance;

//     let metricsConstants = {
//         ABANDON_LOAD: 'abandonload',
//         BUFFER_STATE: 'BufferState'
//     }

//     const somController = new SOMAbrController();
//     let qoeEvaluator = new QoeEvaluator();

//     function setup() {
//     }

//     function getMaxIndex(rulesContext) {
//         let switchRequest = SwitchRequest(context).create();

//         let metricsModel = MetricsModel(context).getInstance();
//         let dashMetrics = DashMetrics(context).getInstance();
//         let mediaType = rulesContext.getMediaInfo().type;
//         let metrics = metricsModel.getMetricsFor(mediaType, true);

//         // Get current bitrate
//         let streamController = StreamController(context).getInstance();
//         let abrController = rulesContext.getAbrController();
//         let current = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());

//         // Additional stuff
//         const mediaInfo = rulesContext.getMediaInfo();
//         const bufferStateVO = dashMetrics.getLatestBufferInfoVO(mediaType, true, metricsConstants.BUFFER_STATE);
//         const scheduleController = rulesContext.getScheduleController();
//         const currentBufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);
//         const streamInfo = rulesContext.getStreamInfo();
//         const isDynamic = streamInfo && streamInfo.manifestInfo ? streamInfo.manifestInfo.isDynamic : null;
//         const throughputHistory = abrController.getThroughputHistory();

//         // latency
//         //const latency = throughputHistory.getAverageLatency(mediaType)/1000;
//         let playbackController = PlaybackController(context).getInstance();
//         let latency = playbackController.getCurrentLiveLatency();
//         if (!latency) latency=0;
//         const playbackRate = playbackController.getPlaybackRate();
        
//         /*
//          * decide which throughput value to use
//          */
//         // const throughput = throughputHistory.getAverageThroughput(mediaType, isDynamic);
//         const throughput = throughputHistory.getSafeAverageThroughput(mediaType, isDynamic);
//         console.log('[TgcLearningRule] throughput: ' + Math.round(throughput) + 'kbps');

//         if (isNaN(throughput) || !bufferStateVO) {
//             return switchRequest;
//         }

//         if (abrController.getAbandonmentStateFor(mediaType) === metricsConstants.ABANDON_LOAD) {
//             return switchRequest;
//         }

//         // QoE parameters
//         let bitrateList=mediaInfo.bitrateList;
//         let segmentDuration = rulesContext.getRepresentationInfo().fragmentDuration;
//         let minBitrateKbps = bitrateList[0].bandwidth / 1000.0;                         // min bitrate level
//         let maxBitrateKbps = bitrateList[bitrateList.length - 1].bandwidth / 1000.0;    // max bitrate level
//         for (let i=0;i<bitrateList.length;i++){
//             let b=bitrateList[i].bandwidth/1000.0;
//             if (b>maxBitrateKbps) maxBitrateKbps=b;
//             else if (b<minBitrateKbps) minBitrateKbps=b;
//         }

//         let currentBitrate=bitrateList[current].bandwidth;
//         let currentBitrateKbps= currentBitrate / 1000.0;
//         let httpRequest = dashMetrics.getCurrentHttpRequest(mediaType, true);
//         let lastFragmentDownloadTime = (httpRequest.tresponse.getTime() - httpRequest.trequest.getTime())/1000;
//         let segmentRebufferTime = lastFragmentDownloadTime>segmentDuration?lastFragmentDownloadTime-segmentDuration:0;
//         qoeEvaluator.setupPerSegmentQoe(segmentDuration, maxBitrateKbps, minBitrateKbps);
//         qoeEvaluator.logSegmentMetrics(currentBitrateKbps, segmentRebufferTime, latency, playbackRate);
//         let currentQoeInfo = qoeEvaluator.getPerSegmentQoe();
//         // let normalizedQoEInverse=  currentQoeInfo.totalQoe / currentBitrateKbps;
//         let normalizedQoEInverse= currentQoeInfo.totalQoe>0 ? 1 / currentQoeInfo.totalQoe : 1;
//         console.log("QoE: ",normalizedQoEInverse);

//         // select next quality using SOM
//         switchRequest.quality = somController.getQualityUsingSom(mediaInfo,throughput*1000,latency/1000,currentBufferLevel,currentBitrate,normalizedQoEInverse);
//         switchRequest.reason = { throughput: throughput, latency: latency};
//         switchRequest.priority = SwitchRequest.PRIORITY.STRONG;

//         scheduleController.setTimeToLoadDelay(0);

//         // logger.debug('[' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
//         if (switchRequest.quality!=current){
//             console.log('[TgcLearningRule][' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
//         }

//         return switchRequest;
//     }


//     instance = {
//         getMaxIndex: getMaxIndex
//     };

//     setup();

//     return instance;
// }

// /* ************************
// *    Main abr logic
// * ************************ */
// class SOMAbrController{

//     constructor() {
//         this.somBitrateNeurons=null;
//         this.bitrateNormalizationFactor=1;
//     }

//     getSomBitrateNeurons(mediaInfo){
//         if (!this.somBitrateNeurons){
//             this.somBitrateNeurons = [];
//             const bitrateList = mediaInfo.bitrateList;
//             let bitrateVector=[];
//             bitrateList.forEach(element => {
//                 bitrateVector.push(element.bandwidth);   
//             });
//             this.bitrateNormalizationFactor=this.getMagnitude(bitrateVector);
//             console.log("throughput normalization factor is "+this.bitrateNormalizationFactor);
            
//             for (let i = 0; i < bitrateList.length; i++) {
//                 let neuron={
//                     qualityIndex: i,
//                     bitrate: bitrateList[i].bandwidth,
//                     state: {
//                         // normalize throughputs
//                         throughput: bitrateList[i].bandwidth/this.bitrateNormalizationFactor,
//                         latency: 0,
//                         buffer: 0,
//                         previousBitrate: bitrateList[i].bandwidth/this.bitrateNormalizationFactor,
//                         QoE: 0
//                     }
//                 }
//                 this.somBitrateNeurons.push(neuron);
//             }
//         }
//         return this.somBitrateNeurons;
//     }

//     getMaxThroughput(){
//         let maxThroughput=0;
//         if (this.somBitrateNeurons){
//             for(let i=0;i<this.somBitrateNeurons.length;i++){
//                 let n=this.somBitrateNeurons[i];
//                 if (n.state.throughput>maxThroughput){
//                     maxThroughput=n.state.throughput;
//                 }
//             }
//         } 
//         return maxThroughput;
//     }

//     getMagnitude(w){
//         return w
//             .map((x) => (x**2)) // square each element
//             .reduce((sum, now) => sum + now) // sum 
//             ** (1/2) // square root
//     }

//     getDistance(a, b, w) {
//         return a
//             .map((x, i) => (w[i] * (x-b[i]) ** 2)) // square the difference*w
//             .reduce((sum, now) => sum + now) // sum
//             ** (1/2) // square root
//     }

//     getNeuronDistance(a, b) {
//         let aState=[a.state.throughput,a.state.latency, a.state.buffer, a.state.previousBitrate, a.state.QoE];
//         let bState=[b.state.throughput,b.state.latency, b.state.buffer, b.state.previousBitrate, b.state.QoE];
//         return this.getDistance(aState,bState,[1,1,1,1,1]);
//     }

//     updateNeurons(winnerNeuron,somElements,x){
//         // update all neurons
//         for (let i =0; i< somElements.length ; i++) {
//             let somNeuron=somElements[i];
//             let sigma=0.1;
//             let neighbourHood=Math.exp(-1*this.getNeuronDistance(somNeuron,winnerNeuron)/(2*sigma**2));
//             this.updateNeuronState(somNeuron,x, neighbourHood);
//         }
//     }

//     updateNeuronState(neuron, x, neighbourHood){
//         let state=neuron.state;
//         let w=[0.01,0.01,0.01,0.01,0.01]; // learning rate
//         // console.log("before update: neuron=",neuron.qualityIndex," throughput=",state.throughput," latency=",state.latency," buffer=",state.buffer)
//         state.throughput=state.throughput+(x[0]-state.throughput)*w[0]*neighbourHood;
//         state.latency=state.latency+(x[1]-state.latency)*w[1]*neighbourHood;
//         state.buffer=state.buffer+(x[2]-state.buffer)*w[2]*neighbourHood;
//         state.previousBitrate=state.previousBitrate+(x[3]-state.previousBitrate)*w[3]*neighbourHood;
//         state.QoE=state.QoE+(x[4]-state.QoE)*w[4]*neighbourHood;
//         console.log("after update: neuron=",neuron.qualityIndex,"throughput=",state.throughput,
//                     "latency=",state.latency," buffer=",state.buffer,
//                     "previousBitrate=",state.previousBitrate,"QoE=",state.QoE);
//     }

//     getQualityUsingSom(mediaInfo, throughput, latency, bufferSize, currentBitrate,QoE){
//         let somElements=this.getSomBitrateNeurons(mediaInfo);
//         // normalize throughput
//         throughput=throughput/this.bitrateNormalizationFactor;
//         // saturate values higher than 1
//         if (throughput>1) throughput=this.getMaxThroughput();
//         let currentBitrateNormalized=currentBitrate/this.bitrateNormalizationFactor;
//         console.log("getQuality called throughput="+throughput+" latency="+latency+" bufferSize="+bufferSize," currentNBitrate=",currentBitrate," QoE=",QoE);

//         let minDistance=null;
//         let minIndex=null;
//         let winnerNeuron=null;
//         let currentNeuron=null;
//         for (let i =0; i< somElements.length ; i++) {
//             let somNeuron=somElements[i];
//             if (somNeuron.bitrate==currentBitrate){
//                 currentNeuron=somNeuron;
//             }
//             let somNeuronState=somNeuron.state;
//             let somData=[somNeuronState.throughput,
//                 somNeuronState.latency,
//                 somNeuronState.buffer,
//                 somNeuronState.previousBitrate,
//                 somNeuronState.QoE];
//             // encourage avaiable throughput bitrates
//             let throughputWeight=(somNeuronState.throughput>throughput)?1:0.5;
//             let weights=[throughputWeight, 0.4, 0.01, 0.00, 0.4]; // throughput, latency, buffer, previousBitrate, QoE 
//             // give 0 as the targetLatency to find the optimum neuron
//             // maximizing QoE = minimizing 1/QoE (~ 0
//             let distance=this.getDistance(somData,[throughput,0,bufferSize,currentBitrateNormalized,0],weights);
//             if (minDistance==null || distance<minDistance){
//                 minDistance=distance;
//                 minIndex=somNeuron.qualityIndex;
//                 winnerNeuron=somNeuron;
//             }
//             console.log("distance=",distance);
//         }

//         // update current neuron and the neighbourhood with the calculated QoE
//         // will punish current if it is not picked
//         this.updateNeurons(currentNeuron,somElements,[throughput,latency,bufferSize,currentBitrateNormalized,QoE]);

//         // update bmu and neighnours with targetQoE=0, targetLatency=0
//         this.updateNeurons(winnerNeuron,somElements,[throughput,0,bufferSize,currentBitrateNormalized,0]);

//         return minIndex;
//     }

    
// }

// TgcLearningRuleClass.__dashjs_factory_name = 'TgcLearningRule';
// TgcLearningRule = dashjs.FactoryMaker.getClassFactory(TgcLearningRuleClass);