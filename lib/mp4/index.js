module.exports = {
  generator: require('./mp4-generator'),
  Transmuxer: require('./transmuxer').Transmuxer,
  AudioSegmentStream: require('./transmuxer').AudioSegmentStream,
  VideoSegmentStream: require('./transmuxer').VideoSegmentStream,
  tools: require('../tools/mp4-inspector'),
  MP4ParserStream: require('./mp4-parser').MP4ParserStream,
  MP4BuilderStream: require('./mp4-parser').MP4BuilderStream,
};
