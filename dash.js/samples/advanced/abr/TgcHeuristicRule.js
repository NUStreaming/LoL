var TgcHeuristicRule;

function TgcHeuristicRuleClass() {

    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
    let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
    let StreamController = factory.getSingletonFactoryByName('StreamController');
    let context = this.context;
    let instance;

    function setup() {
    }

    function getMaxIndex(rulesContext) {
        // here you can get some informations aboit metrics for example, to implement the rule
        let metricsModel = MetricsModel(context).getInstance();
        var mediaType = rulesContext.getMediaInfo().type;
        var metrics = metricsModel.getMetricsFor(mediaType, true);

        // A smarter (real) rule could need analyze playback metrics to take
        // bitrate switching decision. Printing metrics here as a reference
        console.log(metrics);

        // Get current bitrate
        let streamController = StreamController(context).getInstance();
        let abrController = rulesContext.getAbrController();
        let current = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());

        // If already in lowest bitrate, don't do anything
        if (current === 0) {
            return SwitchRequest(context).create();
        }

        // Ask to switch to the lowest bitrate
        let switchRequest = SwitchRequest(context).create();
        switchRequest.quality = 3;
        switchRequest.reason = 'Always switching to the lowest bitrate';
        switchRequest.priority = SwitchRequest.PRIORITY.STRONG;
        return switchRequest;
    }

    instance = {
        getMaxIndex: getMaxIndex
    };

    setup();

    return instance;
}

TgcHeuristicRuleClass.__dashjs_factory_name = 'TgcHeuristicRule';
TgcHeuristicRule = dashjs.FactoryMaker.getClassFactory(TgcHeuristicRuleClass);

