import FactoryMaker from '../../../core/FactoryMaker';
import Debug from '../../../core/Debug';
import SwitchRequest from '../SwitchRequest';
import Constants from '../../constants/Constants';
import MetricsConstants from '../../constants/MetricsConstants';

function TGCRule(config) {

    config = config || {};
    const context = this.context;
    const dashMetrics = config.dashMetrics;

    let instance,
        logger;

    function setup() {
        logger = Debug(context).getInstance().getLogger(instance);
    }

    function checkConfig() {
        if (!dashMetrics || !dashMetrics.hasOwnProperty('getLatestBufferInfoVO')) {
            throw new Error(Constants.MISSING_CONFIG_ERROR);
        }
    }

    function getMaxIndex(rulesContext) {
        // initial content taken from ThroughputRule
        const switchRequest = SwitchRequest(context).create();

        if (!rulesContext || !rulesContext.hasOwnProperty('getMediaInfo') || !rulesContext.hasOwnProperty('getMediaType') || !rulesContext.hasOwnProperty('useBufferOccupancyABR') ||
            !rulesContext.hasOwnProperty('getAbrController') || !rulesContext.hasOwnProperty('getScheduleController')) {
            return switchRequest;
        }

        checkConfig();

        const mediaInfo = rulesContext.getMediaInfo();
        const mediaType = rulesContext.getMediaType();
        const bufferStateVO = dashMetrics.getLatestBufferInfoVO(mediaType, true, MetricsConstants.BUFFER_STATE);
        const scheduleController = rulesContext.getScheduleController();
        const abrController = rulesContext.getAbrController();
        const streamInfo = rulesContext.getStreamInfo();
        const isDynamic = streamInfo && streamInfo.manifestInfo ? streamInfo.manifestInfo.isDynamic : null;
        const throughputHistory = abrController.getThroughputHistory();
        const throughput = throughputHistory.getSafeAverageThroughput(mediaType, isDynamic);
        const latency = throughputHistory.getAverageLatency(mediaType);
        const useBufferOccupancyABR = rulesContext.useBufferOccupancyABR();


        if (isNaN(throughput) || !bufferStateVO || useBufferOccupancyABR) {
            return switchRequest;
        }

        if (abrController.getAbandonmentStateFor(mediaType) !== MetricsConstants.ABANDON_LOAD) {
            if (bufferStateVO.state === MetricsConstants.BUFFER_LOADED || isDynamic) {
                switchRequest.quality = abrController.getQualityForBitrate(mediaInfo, throughput, latency);
                scheduleController.setTimeToLoadDelay(0);
                logger.debug('[' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
                switchRequest.reason = {throughput: throughput, latency: latency};
            }
        }

        return switchRequest;

        // Ask to switch to the lowest bitrate - for debugging
        // let switchRequest = SwitchRequest(context).create();
        // switchRequest.quality = 0;
        // switchRequest.reason = 'Always switching to the lowest bitrate';
        // switchRequest.priority = SwitchRequest.PRIORITY.STRONG;
        // return switchRequest;
    }

    function reset() {
        // no persistent information to reset
    }

    instance = {
        getMaxIndex: getMaxIndex,
        reset: reset
    };

    setup();

    return instance;
}

TGCRule.__dashjs_factory_name = 'TGCRule';
export default FactoryMaker.getClassFactory(TGCRule);
