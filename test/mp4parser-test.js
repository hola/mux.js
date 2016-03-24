(function(window, muxjs){

'use strict'; /*jslint browser:true, es5:true*/
var mp4parser, videofilter, audiofilter, transmuxer;
var identity = new Uint32Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0]);
var frame3_nonp = new Uint8Array([
    0x00, 0x00, 0x00, 0x3d, 0x41, 0x9e, 0x42, 0x78, 0x87, 0x7f, 0x0a, 0x7c,
    0x48, 0xe7, 0xb0, 0xb4, 0x71, 0x53, 0x5b, 0xff, 0xab, 0x07, 0x59, 0xc0,
    0x41, 0x4d, 0xdb, 0xe6, 0xa7, 0x5f, 0x0f, 0x72, 0xc7, 0x2c, 0x79, 0xe8,
    0x00, 0xf1, 0x7c, 0x7e, 0xe9, 0x3c, 0x47, 0xa6, 0xff, 0x2a, 0x11, 0xb3,
    0xb5, 0xc3, 0xcc, 0x17, 0xfc, 0x33, 0xea, 0x0e, 0x93, 0x84, 0x81, 0xd3,
    0xca, 0x6d, 0x83, 0xb9, 0x67
]);
var frame3_p_v = new Uint8Array([
  0x00, 0x00, 0x01, 0x22, 0x01, 0x9e, 0x61, 0x74, 0x42, 0xff, 0x00, 0x54,
  0x2c, 0xa1, 0xa9, 0xa0, 0x0b, 0xed, 0x83, 0x55, 0xe4, 0xa1, 0x0d, 0xe7,
  0xb4, 0x11, 0xa1, 0x7c, 0x21, 0xc1, 0x49, 0x6d, 0xb5, 0xba, 0x08, 0x35,
  0x14, 0xa2, 0x76, 0xfd, 0x4a, 0xe2, 0x73, 0x61, 0xcb, 0x17, 0x0f, 0x1c,
  0xe3, 0xff, 0xc7, 0x9b, 0x5a, 0xfc, 0x91, 0xb4, 0xe3, 0xf0, 0xe7, 0xf7,
  0xdf, 0xd1, 0x4e, 0x1e, 0xfb, 0x84, 0x62, 0x96, 0xf4, 0xff, 0xa9, 0x21,
  0x16, 0x4a, 0xa8, 0x5c, 0x2c, 0x72, 0x4b, 0x0d, 0x15, 0xf6, 0xd9, 0x3c,
  0x76, 0x67, 0xed, 0x9c, 0x49, 0x9b, 0x77, 0xfa, 0x9b, 0xf7, 0x75, 0x2b,
  0x24, 0x8b, 0xb1, 0xaa, 0x39, 0xcf, 0xd3, 0x75, 0x5a, 0x26, 0x33, 0x6b,
  0x6b, 0x1f, 0xa8, 0x5f, 0x97, 0x9e, 0x4a, 0x78, 0x52, 0xcf, 0xc4, 0x61,
  0x96, 0xe7, 0xe7, 0x02, 0xc6, 0x13, 0xc6, 0x1e, 0x51, 0x03, 0xba, 0x9e,
  0xcd, 0xb4, 0x57, 0x3f, 0x31, 0x82, 0x0b, 0xc1, 0xe9, 0x4f, 0x75, 0x24,
  0xcf, 0x33, 0x1a, 0xb9, 0x9c, 0x35, 0x98, 0x97, 0xf4, 0xb4, 0xd0, 0xc3,
  0xa9, 0xf3, 0x62, 0x83, 0xd9, 0xc2, 0xaa, 0xb1, 0x67, 0x70, 0xb3, 0x17,
  0x8b, 0x51, 0x1b, 0x6c, 0x42, 0x59, 0x32, 0xa8, 0x1d, 0x18, 0x42, 0x1e,
  0xe1, 0x88, 0x75, 0x57, 0x7e, 0x6a, 0x71, 0x0f, 0x35, 0x9a, 0x79, 0xf0,
  0x70, 0xe7, 0x58, 0xd1, 0x6e, 0x66, 0x28, 0xb3, 0xee, 0x1b, 0xf7, 0xa8,
  0x81, 0xa6, 0x96, 0x75, 0x7e, 0xd6, 0xb0, 0x88, 0xa8, 0x9a, 0xd4, 0xf0,
  0x1b, 0x56, 0x89, 0xe1, 0x6d, 0xd2, 0xef, 0xed, 0x3a, 0x85, 0xba, 0xe4,
  0x67, 0xd5, 0x0d, 0x43, 0xcf, 0x8a, 0xea, 0x80, 0x4a, 0xc2, 0x73, 0x6d,
  0x43, 0x81, 0xa1, 0x70, 0xf0, 0xd9, 0xc6, 0x8a, 0x01, 0xd8, 0x95, 0xb0,
  0x24, 0xc0, 0x4c, 0x18, 0xf8, 0xbd, 0x5e, 0xf9, 0x6f, 0xf8, 0x5f, 0x10,
  0x4e, 0x3b, 0xe8, 0x8d, 0x72, 0x3b, 0xef, 0xb1, 0x84, 0x3d, 0xf6, 0xa6,
  0xea, 0xd8, 0x78, 0x5a, 0x32, 0xe7, 0x1d, 0x86, 0x7b, 0x0c, 0xaf, 0x02,
  0x71, 0x90, 0xcc, 0x6a, 0x8c, 0x8c
]);
var frame3_p_a = new Uint8Array([
  0x01, 0x18, 0x2d, 0x90, 0xf0, 0x26, 0x4a, 0x24, 0x00, 0x38, 0xe5, 0x29,
  0xc6, 0x35, 0x2e, 0xa8, 0x2e, 0x26, 0x01, 0xea, 0x89, 0x6b, 0x60, 0x38,
  0x50, 0x83, 0xea, 0xd5, 0xae, 0xa8, 0xbc, 0x2c, 0x28, 0x81, 0x04, 0x64,
  0x02, 0xeb, 0x52, 0x35, 0x10, 0x24, 0x14, 0x1f, 0xed, 0x0c, 0x40, 0x75,
  0x34, 0x47, 0x3b, 0x6a, 0x1a, 0xa9, 0x80, 0x8a, 0x2f, 0x34, 0x58, 0xb3,
  0x36, 0x20, 0x7d, 0xfe, 0x1b, 0x0a, 0x55, 0x47, 0x22, 0x9b, 0x54, 0x69,
  0x4f, 0xad, 0xb3, 0x6e, 0xb7, 0x07, 0x72, 0x11, 0x6c, 0xa0, 0x81, 0x81,
  0x89, 0x69, 0x92, 0x25, 0x3e, 0xbc, 0x51, 0xc7, 0xcc, 0xe3, 0x59, 0xce,
  0xbe, 0x3e, 0xd3, 0x8a, 0xab, 0x4e, 0xaf, 0x80, 0xc9, 0x9d, 0x61, 0x64,
  0xb2, 0x63, 0x95, 0x61, 0xf8, 0x0f, 0x2c, 0xc9, 0x57, 0x95, 0x4a, 0x26,
  0x06, 0x1e, 0xf9, 0x99, 0x8d, 0x2a, 0xe5, 0x97, 0x9b, 0xd9, 0x26, 0xa7,
  0x75, 0x25, 0x89, 0x0a, 0x88, 0x4e, 0xd9, 0x2e, 0xa3, 0x58, 0xb4, 0x71,
  0xcc, 0xf0, 0xd5, 0xfb, 0x5d, 0x3c, 0x55, 0x65, 0x99, 0x81, 0x1e, 0xea,
  0xd1, 0xf9, 0x4c, 0x3d, 0xb4, 0x2b, 0x57, 0xa7, 0x5a, 0x03, 0x12, 0x84,
  0x87, 0x3a, 0x31, 0x5f, 0x7e, 0x6f, 0x7b, 0xe3, 0x9d, 0xfd, 0x4c, 0xed,
  0xf1, 0xf6, 0xe3, 0x5c, 0x73, 0x7c, 0xcf, 0xd5, 0xc0, 0x90, 0xa6, 0xa3,
  0x8e, 0x42, 0xc2, 0x3e, 0x2f, 0x3b, 0x5a, 0x70, 0xbc, 0x32, 0xba, 0x8c,
  0xe0, 0x47, 0x7b, 0xb4, 0xde, 0x2a, 0x9b, 0xc7, 0xbd, 0x5b, 0xe1, 0x2a,
  0x92, 0x0c, 0x89, 0xda, 0x52, 0xe3, 0xa7, 0x17, 0x76, 0x55, 0x02, 0x9a,
  0xd5, 0x79, 0xbb, 0xbb, 0x82, 0x44, 0xc5, 0x62, 0x82, 0x00, 0x32, 0xae,
  0xd2, 0xa1, 0x26, 0x56, 0x0c, 0xb0, 0x23, 0x16, 0xca, 0x88, 0x00, 0x00,
  0x8c, 0x4d, 0xb5, 0xdc, 0xcb, 0xe7, 0xa7, 0x8e, 0xa5, 0x5e, 0x6b, 0xc5,
  0xb7, 0xe7, 0xbc, 0xf3, 0xbe, 0x34, 0x2e, 0x32, 0xc5, 0x2c, 0x40, 0xa8,
  0xf7, 0x72, 0x17, 0xc0, 0xac, 0x47, 0xef, 0xb0, 0x10, 0x8e, 0x10, 0x9b,
  0xa7, 0x1f, 0xc9, 0x06, 0x6c, 0x8d, 0xf0, 0x7b, 0x2c, 0x6d, 0x57, 0x17,
  0xbe, 0xc3, 0xa2, 0x7a, 0xcc, 0x4a, 0xa2, 0xab, 0x6e, 0xd6, 0xb6, 0xaa,
  0xcd, 0x9d, 0x1c, 0x78, 0xb0, 0x51, 0x3f, 0xd2, 0x92, 0x5d, 0xc5, 0xd2,
  0x2a, 0xc5, 0xb8, 0x51, 0x8c, 0x60, 0x93, 0x91, 0x8d, 0x4e, 0xe6, 0xb2,
  0xb8, 0xdf, 0x9f, 0x12, 0x5e, 0xbd, 0xf8, 0xda, 0xe6, 0xf8, 0x20, 0x3e,
  0x73, 0x2c, 0xa0, 0xe5, 0x10, 0xa7, 0x7f, 0xd8, 0xd5, 0xc1, 0x97, 0x41,
  0xd2, 0xbc, 0xcd, 0x08, 0xad, 0x28, 0x35, 0xb1, 0xae, 0xa7, 0x7b, 0x61,
  0x7a, 0x37, 0xab, 0xda, 0xeb, 0x45, 0xcd, 0x44, 0x05, 0xc0, 0x2e, 0xbb,
  0x68, 0xd4, 0xf1, 0xf3, 0xb1, 0xf7, 0x9f, 0x63, 0x1a, 0x21, 0x6e, 0x73,
  0x00, 0xb3, 0xaf, 0x86, 0x4c, 0x23, 0x00, 0x00, 0xe0
]);
var video_p_sps = new Uint8Array([103, 100, 0, 12, 172, 217, 65, 65, 251, 1,
    16, 0, 0, 3, 0, 16, 0, 0, 3, 1, 224, 241, 66, 153, 96]);
var video_p_pps = new Uint8Array([104, 235, 227, 203, 34, 192]);
var video_np_sps = new Uint8Array([103, 244, 0, 10, 145, 155, 40, 88, 157, 128,
    136, 0, 0, 3, 0, 8, 0, 0, 3, 0, 160, 120, 145, 44, 176]);
var video_np_pps = new Uint8Array([104, 235, 227, 196, 72, 68]);
function push_collect(stream, data){
    var result = [];
    if (!Array.isArray(data))
        data = [data];
    stream.on('data', function(output){
        output.data = output.data && new Uint8Array(output.data);
        result.push(output);
    });
    data.forEach(function(p){ stream.push(p); });
    stream.flush();
    stream.dispose();
    return result;
}
module('Video Filter Stream', {
    setup: function(){ videofilter = new muxjs.VideoFilterStream(); },
});
test('filter out audio and metadata packets', function(){
    var res = push_collect(videofilter, [
        {data: new Uint8Array([0x00]), type: 'audio'},
        {data: new Uint8Array([0x00]), type: 'metadata'}
    ]);
    ok(res.length===0, 'no audio/metadata packages passed through');
});
test('parse a single sample to correct NALs', function(){
    var res = push_collect(videofilter, {
        data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x05, 0x4, 0x3, 0x2]),
        ts: 16384,
        pts: 173000,
        dts: 172000,
        type: 'video',
        dr: {
            width: 640,
            height: 480,
            ts: 16384,
            avcc: {
                avc_p_i: 100,
                avc_l_i: 30,
                prof_compat: 0,
                n_sps: 2,
                sps: [
                    {l: 3, nal: new Uint8Array([0, 1, 2])},
                    {l: 3, nal: new Uint8Array([3, 4, 5])},
                ],
                n_pps: 1,
                pps: [{l: 3, nal: new Uint8Array([6, 7, 8])}],
            },
        }
    });
    strictEqual(res[0].nalUnitType, 'access_unit_delimiter_rbsp',
        'added AU delimiter');
    strictEqual(res[0].data[0], 0x09, 'correct access_unit_delimiter code');
    strictEqual(res[1].nalUnitType, 'seq_parameter_set_rbsp',
        'inserted 1st SPS');
    deepEqual(res[1].config, {
        profileIdc: 100,
        levelIdc: 30,
        profileCompatibility: 0,
        width: 640,
        height: 480,
    }, 'correct decoder config');
    deepEqual(res[1].data, new Uint8Array([0, 1, 2]), 'correct 1st SPS NAL');
    strictEqual(res[2].nalUnitType, 'seq_parameter_set_rbsp',
        'inserted 2nd SPS');
    deepEqual(res[2].data, new Uint8Array([3, 4, 5]), 'correct 2nd SPS NAL');
    strictEqual(res[3].nalUnitType, 'pic_parameter_set_rbsp', 'inserted PPS');
    deepEqual(res[3].data, new Uint8Array([6, 7, 8]), 'correct PPS NAL');
    strictEqual(res[4].nalUnitType,
        'slice_layer_without_partitioning_rbsp_idr', 'correct mark IDR');
    strictEqual(res[0].dts, res[4].dts, 'consistent DTS during the sample');
    strictEqual(res[0].pts, res[4].pts, 'consistent PTS during the sample');
    strictEqual(res[0].dts, 944824, 'correct DTS scaling');
    strictEqual(res[0].pts, 950317, 'correct PTS scaling');
});
test('parse sample sequence', function(){
    var dr1 = {
        width: 640,
        height: 480,
        avcc: {
            avc_p_i: 100,
            avc_l_i: 30,
            prof_compat: 0,
            n_sps: 2,
            sps: [
                {l: 3, nal: new Uint8Array([0, 1, 2])},
                {l: 3, nal: new Uint8Array([3, 4, 5])},
            ],
            n_pps: 1,
            pps: [{l: 3, nal: new Uint8Array([6, 7, 8])}],
    },
    };
    var dr2 = {
        width: 640,
        height: 480,
        avcc: {
            avc_p_i: 100,
            avc_l_i: 30,
            prof_compat: 0,
            n_sps: 1,
            sps: [
                {l: 3, nal: new Uint8Array([0, 1, 2])},
            ],
            n_pps: 1,
            pps: [{l: 3, nal: new Uint8Array([6, 7, 8])}],
        },
    };
    var res = push_collect(videofilter, [{
        data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x05, 0x4, 0x3, 0x2]),
        type: 'video',
        pts: 173000,
        dts: 172000,
        ts: 16384,
        dr: dr1,
    }, {
        data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x06, 0x04, 0x03, 0x02,
            0x00, 0x00, 0x00, 0x07, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
        type: 'video',
        pts: 175000,
        dts: 173000,
        ts: 16384,
        dr: dr1,
    }, {
        data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x05, 0x04, 0x03, 0x02,
            0x00, 0x00, 0x00, 0x07, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
        type: 'video',
        pts: 175000,
        dts: 173000,
        ts: 16384,
        dr: dr2,
    }]);
    var sequence = [
        'access_unit_delimiter_rbsp',
        'seq_parameter_set_rbsp',
        'seq_parameter_set_rbsp',
        'pic_parameter_set_rbsp',
        'slice_layer_without_partitioning_rbsp_idr',
        'access_unit_delimiter_rbsp',
        undefined,
        undefined,
        'access_unit_delimiter_rbsp',
        'seq_parameter_set_rbsp',
        'pic_parameter_set_rbsp',
        'slice_layer_without_partitioning_rbsp_idr',
        undefined
    ];
    deepEqual(res.map(function(e){ return e.nalUnitType; }), sequence,
        'correct NAL unit sequence');
    deepEqual(res[9].data, new Uint8Array([0, 1, 2]),
        'correct sync SPS NAL after changing of parameters');
});
test('flushing video filter', function(){
    var sample = {
        data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x05, 0x4, 0x3, 0x2]),
        ts: 16384,
        pts: 173000,
        dts: 172000,
        type: 'video',
        dr: {
            width: 640,
            height: 480,
            ts: 16384,
            avcc: {
                avc_p_i: 100,
                avc_l_i: 30,
                prof_compat: 0,
                n_sps: 2,
                sps: [
                    {l: 3, nal: new Uint8Array([0, 1, 2])},
                    {l: 3, nal: new Uint8Array([3, 4, 5])},
                ],
                n_pps: 1,
                pps: [{l: 3, nal: new Uint8Array([6, 7, 8])}],
            },
        },
    };
    var res1 = push_collect(videofilter, sample);
    var res2 = push_collect(videofilter, sample);
    var sequence = [
        'access_unit_delimiter_rbsp',
        'seq_parameter_set_rbsp',
        'seq_parameter_set_rbsp',
        'pic_parameter_set_rbsp',
        'slice_layer_without_partitioning_rbsp_idr'
    ];
    deepEqual(res2.map(function(e){ return e.nalUnitType; }), sequence,
        'correct resync after flushing');
});

module('Audio Filter Stream', {
    setup: function(){ audiofilter = new muxjs.AudioFilterStream(); },
});
test('filter out video and metadata packets', function(){
    var res = push_collect(audiofilter, [
        {data: new Uint8Array([0x00]), type: 'video'},
        {data: new Uint8Array([0x00]), type: 'metadata'}
    ]);
    ok(res.length===0, 'no video/metadata packages passed through');
});
test('correct output with added decoder information', function(){
    var packet = {
        data: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]),
        type: 'audio',
        ts: 44100,
        pts: 441000,
        dts: 441000,
        dr: {
            s_rate: 44100,
            s_size: 5,
            esds: {
                channel: 2,
                freq: 4,
                aot: 2,
            },
        },
    };
    var res = push_collect(audiofilter, packet);
    strictEqual(res[0].samplerate, 44100, 'correct sample rate');
    strictEqual(res[0].samplesize, 5, 'correct sample size');
    strictEqual(res[0].channelcount, 2, 'correct channel count');
    strictEqual(res[0].audioobjecttype, 2, 'correct object type');
    strictEqual(res[0].samplingfrequencyindex, 4, 'correct freq index');
    strictEqual(res[0].ts, 44100, 'correct time scale');
    strictEqual(res[0].dts, 900000, 'correct DTS');
    strictEqual(res[0].pts, 900000, 'correct PTS');
    deepEqual(res[0].data, new Uint8Array([0, 1, 2, 3, 4]),
        'correct sample data');
    res = push_collect(audiofilter, packet);
    strictEqual(res.length, 1, 'survived flush');
});

module('MP4 Parser Stream', {
    setup: function(){ mp4parser = new muxjs.MP4ParserStream(); },
});
test('empty input does not error', function(){
    mp4parser.push(new Uint8Array([]));
    ok(true, 'did not throw');
});
test('parsing progressive MP4', function(){
    var res = push_collect(mp4parser, mp4video_p);
    ok(true, 'did not throw');
    strictEqual(res[0].type, 'metadata', 'parsed metadata');
    strictEqual(res[0].tracks[0].type, 'video', 'identified video track');
    strictEqual(res[0].tracks[0].duration, 360000, 'correct video duration');
    strictEqual(res[0].tracks[0].track_width, 320, 'correct video width');
    strictEqual(res[0].tracks[0].track_height, 240, 'correct video height');
    strictEqual(res[0].tracks[0].bitrate, 171836, 'correct video bitrate');
    strictEqual(res[0].tracks[1].bitrate, 130048, 'correct audio bitrate');
    strictEqual(res[0].tracks[0].timelineStartInfo.baseMediaDecodeTime, 0,
        'correct track start time');
    strictEqual(res[0].tracks.length, 2, 'correct number of tracks');
    strictEqual(res[1].type, 'video', 'correct 1st frame type');
    strictEqual(res[1].dr.width, 320, 'correct width descriptor');
    strictEqual(res[1].dr.height, 240, 'correct descriptor height');
    strictEqual(res[1].dr.avcc.avc_p_i, 100, 'correct descriptor profile');
    strictEqual(res[1].dr.avcc.prof_compat, 0,
        'correct descriptor compatibility');
    strictEqual(res[1].dr.avcc.avc_l_i, 12, 'correct descriptor level');
    deepEqual(res[1].dr.avcc.sps[0], {
        l: 25,
        nal: video_p_sps,
    }, 'correct SPS descriptor');
    deepEqual(res[1].dr.avcc.pps[0], {
        l: 6,
        nal: video_p_pps,
    }, 'correct PPS descriptor');
    deepEqual(res[7].data, frame3_p_v, 'correct intermittent video frame');
    deepEqual(res[8].data, frame3_p_a, 'correct intermittent audio frame');
});
test('parsing non-progressive MP4', function(){
    var res = push_collect(mp4parser, mp4video_nonp);
    ok(true, 'did not throw');
    strictEqual(res[0].type, 'metadata', 'parsed metadata');
    strictEqual(res[0].tracks[0].type, 'video', 'identified video track');
    strictEqual(res[0].tracks[0].duration, 477000, 'correct video duration');
    strictEqual(res[0].tracks[0].track_width, 176, 'correct video width');
    strictEqual(res[0].tracks[0].track_height, 144, 'correct video height');
    strictEqual(res[0].tracks[0].timelineStartInfo.baseMediaDecodeTime, 0,
        'correct track start time');
    strictEqual(res[0].tracks.length, 1, 'correct number of tracks');
    strictEqual(res[1].type, 'video', 'correct 1st frame type');
    strictEqual(res[1].dr.width, 176, 'correct width descriptor');
    strictEqual(res[1].dr.height, 144, 'correct descriptor height');
    strictEqual(res[1].dr.avcc.avc_p_i, 244, 'correct descriptor profile');
    strictEqual(res[1].dr.avcc.prof_compat, 0,
        'correct descriptor compatibility');
    strictEqual(res[1].dr.avcc.avc_l_i, 10, 'correct descriptor level');
    deepEqual(res[1].dr.avcc.sps[0], {
        l: 25,
        nal: video_np_sps,
    }, 'correct SPS descriptor');
    deepEqual(res[1].dr.avcc.pps[0], {
        l: 6,
        nal: video_np_pps,
    }, 'correct PPS descriptor');
    deepEqual(res[3].data, frame3_nonp, 'correct intermittent frame');
});
test('parsing non-progressive MP4 with small window size', function(){
    var window_size = 256;
    var res = [];
    mp4parser.on('data', function(output){
        output.data = output.data&&new Uint8Array(output.data);
        res.push(output);
    });
    var pos = 0;
    while (pos<mp4video_nonp.length)
    {
        pos = mp4parser.push(mp4video_nonp.slice(pos, Math.min(pos+window_size,
            mp4video_nonp.length)));
    }
    mp4parser.flush();
    mp4parser.dispose();
    ok(true, 'did not throw');
    strictEqual(res[0].type, 'metadata', 'parsed metadata');
    strictEqual(res[0].tracks[0].duration, 477000, 'correct video duration');
    strictEqual(res[0].tracks.length, 1, 'correct number of tracks');
    strictEqual(res[1].type, 'video', 'correct 1st frame type');
    strictEqual(res[1].dr.width, 176, 'correct width descriptor');
    strictEqual(res[1].dr.height, 144, 'correct descriptor height');
    strictEqual(res[1].dr.avcc.avc_p_i, 244, 'correct descriptor profile');
    strictEqual(res[1].dr.avcc.prof_compat, 0,
        'correct descriptor compatibility');
    strictEqual(res[1].dr.avcc.avc_l_i, 10, 'correct descriptor level');
    deepEqual(res[3].data, frame3_nonp, 'correct intermittent frame');
});
test('seeking MP4', function(){
    var window_size = 16384;
    var is_metadata = false;
    mp4parser.on('data', function(output){
        if (output.type=='metadata')
            is_metadata = true;
    });
    var pos = 0;
    while (!is_metadata&&pos<mp4video_s.length)
    {
        pos = mp4parser.push(mp4video_s.slice(pos, Math.min(pos+window_size,
            mp4video_s.length)));
    }
    ok(true, 'parsed metadata');
    strictEqual(mp4parser.seek(7, true).offset, 99104,
        'seek position of 7s sync ok');
    strictEqual(mp4parser.seek(8, true).offset, 99104,
        'seek position of 8s sync ok');
    strictEqual(mp4parser.seek(7, false).offset, 202013,
        'seek position of 7s off-sync ok');
    strictEqual(mp4parser.seek(8, false).offset, 255505,
        'seek position of 8s off-sync ok');
    var si = mp4parser.seek(7, true);
    deepEqual(mp4parser.seek(si.time, true), si,
        'seek position of 7s sync stability');
    deepEqual(mp4parser.seek(8, true), si,
        'seek position of 8s sync stability');
    var si = mp4parser.seek(4.1, true);
    deepEqual(mp4parser.seek(si.time, true), si,
        'seek position of 4.1s sync stability');
});

module('Transmuxer Stream', {
    setup: function(){
        transmuxer = new muxjs.mp2t.Transmuxer({input_type: 'mp4'}); },
});
test('full pipeline test', function(){
    var res = push_collect(transmuxer, mp4video_p);
    var inspectMp4 = muxjs.inspectMp4;
    var boxes = res[0].inits.map(e=>inspectMp4(e.buffer))
    .concat(res.slice(1).map(e=>inspectMp4(e.data)));
    function check_trak(box, type){
        strictEqual(box.type, 'trak', 'there is track box');
        strictEqual(box.boxes[0].type, 'tkhd', 'there is track header');
        deepEqual(box.boxes[0].matrix, identity, 'correct track matrix');
        strictEqual(box.boxes[0].width, type=='video' ? 320 : 0,
            'correct width');
        strictEqual(box.boxes[0].height, type=='video' ? 240 : 0,
            'correct heigth');
        strictEqual(box.boxes[0].duration, type=='video' ? 360000 : 193024,
            'correct duration');
        strictEqual(box.boxes[2].boxes[0].timescale, type=='video' ?
            90000 : 48000, 'correct timescale');
        strictEqual(box.boxes[2].boxes[1].handlerType, type=='video' ?
            'vide' : 'soun', 'correct handler');
        var stbl = box.boxes[2].boxes[2].boxes[2];
        strictEqual(stbl.type, 'stbl', 'correct stbl type');
        strictEqual(stbl.boxes[0].type, 'stsd', 'there is stsd box');
        if (type=='video')
        {
            deepEqual(stbl.boxes[0].sampleDescriptions[0], {
                dataReferenceIndex: 1,
                width: 320,
                height: 240,
                horizresolution: 72,
                vertresolution: 72,
                frameCount: 1,
                depth: 24,
                type: 'avc1',
                size: 156,
                config: [{
                    configurationVersion: 1,
                    avcProfileIndication: 100,
                    profileCompatibility: 0,
                    avcLevelIndication: 12,
                    lengthSizeMinusOne: 3,
                    sps: [video_p_sps],
                    pps: [video_p_pps],
                    size: 50,
                    type: 'avcC'
                }, {
                    bufferSizeDB: 1875072,
                    maxBitrate: 3000000,
                    avgBitrate: 3000000,
                    size: 20,
                    type: 'btrt'
                }],
            }, 'correct descriptor');
        }
        else
        {
            deepEqual(stbl.boxes[0].sampleDescriptions[0], {
                dataReferenceIndex: 1,
                channelcount: 6,
                samplesize: 16,
                samplerate: 48000,
                streamDescriptor: {
                    version: 0,
                    flags: new Uint8Array([0, 0, 0]),
                    esId: 0,
                    streamPriority: 0,
                    decoderConfig: {
                        objectProfileIndication: 64,
                        streamType: 5,
                        bufferSize: 1536,
                        maxBitrate: 56000,
                        avgBitrate: 56000,
                        decoderConfigDescriptor: {
                            tag: 5,
                            length: 2,
                            audioObjectType: 2,
                            samplingFrequencyIndex: 3,
                            channelConfiguration: 6
                        },
                    },
                    size: 39,
                    type: 'esds'},
                size: 75,
                type: 'mp4a',
            }, 'correct descriptor');
        }
    }
    function check_moof(box, type){
        strictEqual(box.boxes[1].type, 'traf', 'there is traf box');
        strictEqual(box.boxes[1].boxes[2].type, 'trun', 'there is trun box');
        strictEqual(box.boxes[1].boxes[2].dataOffset, box.size+8,
            'correct data offset in trun');
        deepEqual(box.boxes[1].boxes[2].flags, type=='video' ?
            new Uint8Array([0, 15, 1]) : new Uint8Array([0, 3, 1]),
            'correct trun flags');
        strictEqual(box.boxes[1].boxes[2].samples.length, 10,
            'correct number of samples');
    }
    ok(true, 'does not throw');
    equal(res.length, 26, 'correct fragment');
    deepEqual(boxes.slice(0, 2).map(e=>e.map(x=>x.type)), [['ftyp', 'moov'],
        ['ftyp', 'moov']], 'correct init sequence');
    deepEqual(boxes.slice(0,4).map(e=>e.map(x=>x.size)), [[20, 689],
        [20, 604], [282, 24089], [282, 15051]], 'correct frame sizes');
    strictEqual(boxes[0][1].boxes[0].type, 'mvhd', 'there is movie header');
    strictEqual(boxes[0][1].boxes[0].duration, 360000, 'correct duration');
    strictEqual(boxes[0][1].boxes[0].timescale, 90000, 'correct timescale');
    deepEqual(boxes[0][1].boxes[0].matrix, identity, 'correct matrix');
    check_trak(boxes[0][1].boxes[1], 'video');
    check_trak(boxes[1][1].boxes[1], 'audio');
    check_moof(boxes[2][0], 'video');
    check_moof(boxes[8][0], 'audio');
});

})(window, window.muxjs);
