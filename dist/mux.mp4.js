// file:lib/stream.js
/**
 * mux.js
 *
 * Copyright (c) 2014 Brightcove
 * All rights reserved.
 *
 * A lightweight readable stream implemention that handles event dispatching.
 * Objects that inherit from streams should call init in their constructors.
 */
(function(window, undefined) {
  var Stream = function() {
    this.init = function() {
      var listeners = {};
      /**
       * Add a listener for a specified event type.
       * @param type {string} the event name
       * @param listener {function} the callback to be invoked when an event of
       * the specified type occurs
       */
      this.on = function(type, listener) {
        if (!listeners[type]) {
          listeners[type] = [];
        }
        listeners[type].push(listener);
      };
      /**
       * Remove a listener for a specified event type.
       * @param type {string} the event name
       * @param listener {function} a function previously registered for this
       * type of event through `on`
       */
      this.off = function(type, listener) {
        var index;
        if (!listeners[type]) {
          return false;
        }
        index = listeners[type].indexOf(listener);
        listeners[type].splice(index, 1);
        return index > -1;
      };
      /**
       * Trigger an event of the specified type on this stream. Any additional
       * arguments to this function are passed as parameters to event listeners.
       * @param type {string} the event name
       */
      this.trigger = function(type) {
        var callbacks, i, length, args;
        callbacks = listeners[type];
        if (!callbacks) {
          return;
        }
        // Slicing the arguments on every invocation of this method
        // can add a significant amount of overhead. Avoid the
        // intermediate object creation for the common case of a
        // single callback argument
        if (arguments.length === 2) {
          length = callbacks.length;
          for (i = 0; i < length; ++i) {
            callbacks[i].call(this, arguments[1]);
          }
        } else {
          args = [];
          i = arguments.length;
          for (i = 1; i < arguments.length; ++i) {
            args.push(arguments[i])
          }
          length = callbacks.length;
          for (i = 0; i < length; ++i) {
            callbacks[i].apply(this, args);
          }
        }
      };
      /**
       * Destroys the stream and cleans up.
       */
      this.dispose = function() {
        listeners = {};
      };
    };
  };
  /**
   * Forwards all `data` events on this stream to the destination stream. The
   * destination stream should provide a method `push` to receive the data
   * events as they arrive.
   * @param destination {stream} the stream that will receive all `data` events
   * @param autoFlush {boolean} if false, we will not call `flush` on the destination
   *                            when the current stream emits a 'done' event
   * @see http://nodejs.org/api/stream.html#stream_readable_pipe_destination_options
   */
  Stream.prototype.pipe = function(destination) {
    this.on('data', function(data) {
      destination.push(data);
    });

    this.on('done', function() {
      destination.flush();
    });

    return destination;
  };

  // Default stream functions that are expected to be overridden to perform
  // actual work. These are provided by the prototype as a sort of no-op
  // implementation so that we don't have to check for their existence in the
  // `pipe` function above.
  Stream.prototype.push = function(data) {
    this.trigger('data', data);
  };
  Stream.prototype.flush = function() {
    this.trigger('done');
  };

  window.muxjs = window.muxjs || {};
  window.muxjs.Stream = Stream;
})(this);
// file:lib/mp4parser.js
(function(window, muxjs, undefined){

'use strict'; /*jslint browser:true, es5:true*/
function byte_to_hex(bt){ return ('0'+bt.toString(16)).slice(-2); }
function int_to_str(tp){
    return String.fromCharCode(tp>>24&255, tp>>16&255, tp>>8&255, tp&255); }
function getUint64(view, ptr){
    return view.getUint32(ptr+4)+view.getUint32(ptr)*0x100000000; }
function getInt64(view, ptr){
    var hib = view.getUint8(ptr);
    if (hib<128)
        return getUint64(view, ptr);
    return view.getUint32(ptr+4)+0x100000000*(view.getUint32(ptr)-0x100000000);
}
var sample_type={vide: 'video', soun: 'audio'};
var full_box = ['meta', 'mvhd', 'tkhd', 'mdhd', 'smhd', 'vmhd', 'dref',
    'hdlr', 'stsd', 'esds', 'stts', 'stss', 'ctts', 'stsc', 'stsz', 'stco',
    'esds', 'elst', 'nmhd'];
var raw_copy = ['udta', 'smhd', 'vmhd', 'dref', 'iods', 'btrt', 'pasp',
    'sdtp', 'uuid', 'colr', 'sbgp', 'sgpd', 'gmhd', 'tref', 'nmhd', 'svcC'];
var containers = {
    meta: {name: 'meta_box'},
    trak: {name: 'track_info', multi: 1},
    edts: {name: 'edit_list'},
    mdia: {name: 'media_box'},
    minf: {name: 'media_info'},
    dinf: {name: 'data_info'},
    stbl: {name: 'sample_table'},
};
var Box_parser = function(){};
Box_parser.prototype = {};
Box_parser.prototype.header = function(opt){
    while (opt.ptr+opt.buffer.b_pos>=opt.branch.last)
    {
        if (opt.branch._id=='movie_box')
            opt.root.h_parsed = true;
        opt.branch = opt.branch.parent;
    }
    opt.type = null;
    opt.offset = 8;
    if (opt.buffer.b_size-opt.ptr<8)
        return;
    opt.size = opt.view.getUint32(opt.ptr);
    if (opt.size==1)
    {
        opt.offset = 16;
        if (opt.buffer.b_size-opt.ptr<16)
            return;
        opt.size = (opt.view.getUint32(opt.ptr+8)<<32)+
            opt.view.getUint32(opt.ptr+12);
    }
    opt.type = int_to_str(opt.view.getUint32(opt.ptr+4));
    if (full_box.indexOf(opt.type)>-1)
    {
        var extra = opt.view.getUint8(opt.ptr+opt.offset);
        opt.offset += 4;
        opt.ver = extra>>>24;
        opt.flags = extra&&0xFFFFFF;
    }
    opt.size -= opt.offset;
    opt.ptr += opt.offset;
};
Box_parser.prototype.parse = function(opt){
    if (!this[opt.type])
        throw new Error('Unknown box type: '+opt.type);
    this[opt.type](opt);
};
raw_copy.forEach(function(cont){
    Box_parser.prototype[cont] = function(opt){
        var data = opt.branch[cont] = new Uint8Array(opt.size);
        data.set(opt.buffer._buff.subarray(opt.ptr, opt.ptr+opt.size));
    };
});
Object.keys(containers).forEach(function(cont){
    Box_parser.prototype[cont] = function(opt){
        var elm = containers[cont];
        opt.branch[elm.name] = opt.branch[elm.name]||(elm.multi ? [] : {});
        var new_branch = opt.branch[elm.name];
        if (elm.multi)
        {
            new_branch.push({});
            new_branch = new_branch[new_branch.length-1];
        }
        new_branch.parent = opt.branch;
        new_branch.last = opt.buffer.b_pos+opt.ptr+opt.size;
        new_branch._id = elm.name;
        opt.branch = new_branch;
        opt.size = 0;
    };
});
Box_parser.prototype.moov = function(opt){
    var new_branch = opt.branch.movie_box = opt.branch.movie_box||{};
    new_branch.parent = opt.branch;
    new_branch.last = opt.buffer.b_pos+opt.ptr+opt.size;
    new_branch._id = 'movie_box';
    // only ftyp can exist prior to moov in a file beginning
    if (opt.buffer.b_pos<256)
        opt.branch.start_hdr_sz = opt.size;
    else
        opt.branch.end_hdr_sz = opt.size;
    opt.branch = new_branch;
    opt.size = 0;
};
function get_hd_times(opt){
    var view = opt.view, ptr = opt.ptr, is_tk = opt.type=='tkhd';
    if (!opt.ver)
    {
        return [view.getUint32(ptr), view.getUint32(ptr+4),
            view.getUint32(ptr+8), view.getUint32(ptr+(is_tk ? 16 : 12))];
    }
    return [getUint64(view, ptr), getUint64(view, ptr+8),
        view.getUint32(ptr+16), getUint64(view, ptr+(is_tk ? 24 : 20))];

}
function get_table(view, ptr, cnt, tbl){
    for (var i=0; i<cnt; i++)
        tbl[i] = view.getUint32(ptr+i*4);
}
function get_unpack(view, ptr, cnt, tbl){
    for (var i=0; i<cnt; i++)
    {
        var u_cnt = view.getUint32(ptr+i*8), data = view.getUint32(ptr+i*8+4);
        for (var j=0; j<u_cnt; j++)
            tbl.push(data);
    }
}
Box_parser.prototype.ftyp = function(opt){
    opt.branch.major_brand = int_to_str(opt.view.getUint32(opt.ptr));
    opt.branch.minor_version = opt.view.getUint32(opt.ptr+4);
    opt.branch.compatible = [opt.branch.major_brand];
    for (var i=8; i<opt.size; i+=4)
        opt.branch.compatible.push(int_to_str(opt.view.getUint32(opt.ptr+i)));
};
Box_parser.prototype.mdat = function(){};
Box_parser.prototype.free = function(){};
Box_parser.prototype.mvhd = function(opt){
    var view = opt.view, ptr = opt.ptr;
    var offset = opt.ver ? 28 : 16;
    var hdr = opt.branch.mv_hdr = {};
    var times = get_hd_times(opt);
    hdr.creation_time = times[0];
    hdr.modification_time = times[1];
    hdr.time_scale = times[2];
    hdr.duration = times[3];
    ptr += offset;
    hdr.rate = view.getUint32(ptr)/65536.0;
    hdr.volume = view.getUint16(ptr+4)/256.0;
    get_table(opt.view, ptr+16, 9, hdr.matrix = []);
    hdr.next_track = view.getUint32(ptr+76);
};
Box_parser.prototype.tkhd = function(opt){
    var view = opt.view, ptr = opt.ptr;
    var offset = opt.ver ? 40 : 28;
    var hdr = opt.branch.tk_hdr = {};
    var times = get_hd_times(opt);
    hdr.enabled = !!(opt.flags&1);
    hdr.in_movie = !!(opt.flags&2);
    hdr.in_preview = !!(opt.flags&4);
    hdr.creation_time = times[0];
    hdr.modification_time = times[1];
    hdr.track_id = times[2];
    hdr.duration = times[3];
    ptr += offset;
    hdr.layer = view.getUint16(ptr);
    hdr.alternate_group = view.getUint16(ptr+2);
    hdr.volume = view.getInt16(ptr+4)/256.0;
    get_table(opt.view, ptr+8, 9, hdr.matrix = []);
    hdr.width = view.getUint32(ptr+44)/65536.0;
    hdr.height = view.getUint32(ptr+48)/65536.0;
};
Box_parser.prototype.mdhd = function(opt){
    var view = opt.view, ptr = opt.ptr;
    var offset = opt.ver ? 28 : 16;
    var hdr = opt.branch.md_hdr = {};
    var times = get_hd_times(opt);
    hdr.creation_time = times[0];
    hdr.modification_time = times[1];
    hdr.time_scale = times[2];
    hdr.duration = times[3];
    var lang = view.getUint16(ptr+offset);
    hdr.lang = String.fromCharCode(lang>>10|96, lang>>5&31|96, lang&31|96);
};
Box_parser.prototype.elst = function(opt){
    var view = opt.view, ptr = opt.ptr+4;
    var count = opt.view.getUint32(opt.ptr);
    opt.branch.list = [];
    for (var i=0; i<count; ptr += 4, i++)
    {
        var elm = {};
        if (opt.ver)
        {
            elm.segment_duration = getUint64(view, ptr);
            elm.media_time = getInt64(view, ptr+8);
            ptr += 16;
        }
        else
        {
            elm.segment_duration = view.getUint32(ptr);
            elm.media_time = view.getInt32(ptr+4);
            ptr += 8;
        }
        elm.media_rate = view.getInt16(ptr);
        opt.branch.list.push(elm);
    }
};
Box_parser.prototype.hdlr = function(opt){
    opt.branch.handler = int_to_str(opt.view.getUint32(opt.ptr+4)); };
Box_parser.prototype._parse_avcc = function(opt, elm){
    var view = opt.view, ptr = opt.ptr;
    var sps = elm.sps = [];
    var pps = elm.pps = [];
    elm.avc_p_i = view.getUint8(ptr+1);
    elm.prof_compat = view.getUint8(ptr+2);
    elm.avc_l_i = view.getUint8(ptr+3);
    elm.l_size_m_1 = view.getUint8(ptr+4)&3;
    elm.n_sps = view.getUint8(ptr+5)&31;
    var offset = 6;
    for (var i=0; i<elm.n_sps; i++)
    {
        sps[i] = {l: view.getUint16(ptr+offset)};
        offset += 2;
        sps[i].nal = new Uint8Array(opt.buffer._buff.subarray(ptr+offset,
            ptr+offset+sps[i].l));
        offset += sps[i].l;
    }
    elm.n_pps = view.getUint8(ptr+offset++);
    for (i=0; i<elm.n_pps; i++)
    {
        pps[i] = {l: view.getUint16(ptr+offset)};
        offset += 2;
        pps[i].nal = new Uint8Array(opt.buffer._buff.subarray(ptr+offset,
            ptr+offset+pps[i].l));
        offset += pps[i].l;
    }
};
Box_parser.prototype._parse_esds = function(opt, elm){
    var view = opt.view, ptr = opt.ptr;
    while (ptr<opt.ptr+opt.size)
    {
        var tag = view.getUint8(ptr++);
        var sz = 0, sb;
        do {
            sb = view.getUint8(ptr++);
            sz = (sz<<7)+(sb&0x7F);
        } while (sb&0x80);
        switch (tag)
        {
        case 3: // ES_DescrTag
            elm.es_id = view.getUint16(ptr);
            var flags = view.getUint8(ptr+2);
            ptr += 3+(flags>>6&2)+(flags>>4&2);
            break;
        case 4: // DecoderConfigDescrTag
            elm.obj_t = view.getUint8(ptr);
            elm.str_t = view.getUint8(ptr+1)&0x3F;
            ptr += 13;
            break;
        case 5: // DecoderSpecificInfoTag
            var asc = view.getUint16(ptr);
            elm.aot = asc>>11&0x1F;
            if (elm.aot==31)
            {
                elm.aot = 32+(asc>>5&0x3F);
                asc <<= 6;
            }
            elm.freq = asc>>7&0xF;
            if (elm.freq==15)
            {
                asc = view.getUint32(ptr+1);
                if (aot<31)
                    elm.freq = asc>>7&0xFFFFFF;
                else
                {
                    elm.freq = asc>>2&0xFFFFFF;
                    asc = view.getUint16(ptr+4)>>3;
                }
            }
            elm.channel = asc>>3&0xF;
            ptr += sz;
            break;
        default:
            ptr += sz;
        }
    }
};
Box_parser.prototype.stsd = function(opt){
    var view = opt.view;
    var count = view.getUint32(opt.ptr);
    var handler = opt.branch.parent.parent.handler;
    opt.branch.list = {};
    opt.ptr += 4;
    for (var i=0; i<count; i++)
    {
        this.header(opt);
        var elm = {};
        var index = view.getUint16(opt.ptr+6);
        switch (handler)
        {
        case 'vide':
            elm.width = view.getUint16(opt.ptr+24);
            elm.height = view.getUint16(opt.ptr+26);
            elm.h_res = view.getUint32(opt.ptr+28)/65536.0;
            elm.v_res = view.getUint32(opt.ptr+32)/65536.0;
            elm.f_count = view.getUint16(opt.ptr+40);
            elm.compressor = '';
            for (var j=0; j<32; j++)
            {
                var c = view.getUint8(opt.ptr+42+j);
                if (!c)
                    break;
                elm.compressor += String.fromCharCode();
            }
            elm.depth = view.getUint16(opt.ptr+74);
            var skip_boxes = [0x63616C70, 0x70617370]; // calp & pasp
            while (skip_boxes.indexOf(view.getUint32(opt.ptr+82))>0)
                opt.ptr += view.getUint32(opt.ptr+78);
            if (view.getUint32(opt.ptr+82)==0x61766343) // avcC
            {
                elm.avcc = {};
                opt.ptr += 78;
                this.header(opt);
                this._parse_avcc(opt, elm.avcc);
            }
            // XXX pavelki: optional boxes
            break;
        case 'soun':
            elm.c_count = view.getUint16(opt.ptr+16);
            elm.s_size = view.getUint16(opt.ptr+18);
            elm.s_rate = view.getUint32(opt.ptr+24)/65536.0;
            if (view.getUint32(opt.ptr+32)==0x65736473) // esds
            {
                elm.esds = {};
                opt.ptr += 28;
                this.header(opt);
                this._parse_esds(opt, elm.esds);
            }
            break;
        default:
        }
        opt.ptr += opt.size;
        opt.branch.list[index] = elm;
    }
    opt.size = 0;
};
Box_parser.prototype.stts = function(opt){
    get_unpack(opt.view, opt.ptr+4, opt.view.getUint32(opt.ptr),
        opt.branch.dtts = []);
};
Box_parser.prototype.ctts = function(opt){
    get_unpack(opt.view, opt.ptr+4, opt.view.getUint32(opt.ptr),
        opt.branch.ctts = []);
};
Box_parser.prototype.stsc = function(opt){
    var count = opt.view.getUint32(opt.ptr);
    var table = opt.branch.s_t_c = [];
    var view = opt.view, ptr = opt.ptr+4;
    for (var i=0; i<count; i++)
    {
        table[i] = {
            f_c: view.getUint32(ptr+i*12),
            s_p_c: view.getUint32(ptr+i*12+4),
            s_d_i: view.getUint32(ptr+i*12+8),
        };
    }
    table.sort(function(c1, c2){ return c1.f_c-c2.f_c; });
};
Box_parser.prototype.stss = function(opt){
    get_table(opt.view, opt.ptr+4, opt.view.getUint32(opt.ptr),
        opt.branch.s_sync = []);
};
Box_parser.prototype.stsz = function(opt){
    opt.branch.s_sz = opt.view.getUint32(opt.ptr);
    opt.branch.s_count = opt.view.getUint32(opt.ptr+4);
    if (!opt.branch.s_sz)
    {
        get_table(opt.view, opt.ptr+8, opt.branch.s_count,
            opt.branch.s_sz = []);
    }
};
Box_parser.prototype.stco = function(opt){
    get_table(opt.view, opt.ptr+4, opt.view.getUint32(opt.ptr),
        opt.branch.c_off = []);
};

var Chunk_parser = function(opt){
    opt = opt||{};
    this.break_on_sync = !!opt.no_multi_init;
    this.frag_size = opt.frag_size||10;
};
Chunk_parser.prototype = {};
Chunk_parser.prototype.process = function(opt){
    var event = {
        type: 'metadata',
        tracks: [],
        brands: opt.root.compatible,
        matrix: opt.root.movie_box.mv_hdr.matrix,
        start_hdr_sz: opt.root.start_hdr_sz,
        end_hdr_sz: opt.root.end_hdr_sz,
    };
    var _this = this;
    event.duration = Math.floor(opt.root.movie_box.mv_hdr.duration*90000/
        opt.root.movie_box.mv_hdr.time_scale);
    event.timescale = 90000;
    this.s_info = [];
    this.s_p = [];
    opt.root.movie_box.track_info.forEach(function(tr){
        if (['vide', 'soun'].indexOf(tr.media_box.handler)<0)
            return;
        var elm = {
            id: tr.tk_hdr.track_id,
            ts: tr.media_box.md_hdr.time_scale,
            type: tr.media_box.handler,
            s_off: [],
            s_time: [],
            s_dri: [],
            s_sync: tr.media_box.media_info.sample_table.s_sync||[],
            s_sz: tr.media_box.media_info.sample_table.s_sz,
            s_ctts: tr.media_box.media_info.sample_table.ctts||[],
            s_list: tr.media_box.media_info.sample_table.list,
        };
        if (tr.edit_list && tr.edit_list.list.length)
            elm.elst = tr.edit_list.list;
        var c_off = tr.media_box.media_info.sample_table.c_off;
        var s_t_c = tr.media_box.media_info.sample_table.s_t_c;
        var dtts = tr.media_box.media_info.sample_table.dtts;
        var c_n = 1;
        var sn = 0;
        var dt = 0;
        for (var i = 0; i<s_t_c.length; i++)
        {
            for (; c_n<(s_t_c[i+1] ? s_t_c[i+1].f_c : c_off.length+1); c_n++)
            {
                var off = c_off[c_n-1];
                for (var j=0; j<s_t_c[i].s_p_c; j++)
                {
                    elm.s_off[sn] = off;
                    elm.s_time[sn] = dt;
                    elm.s_dri[sn] = s_t_c[i].s_d_i;
                    dt += dtts[sn];
                    off += elm.s_sz[sn++]||elm.s_sz;
                }
            }
        }
        _this.s_info.push(elm);
        _this.s_p.push({s: 0, max_t: 0});
        if (elm.type=='vide')
            _this.v_idx = _this.s_info.length-1;
        var event_elm = {
            id: elm.id,
            type: sample_type[elm.type],
            edit_list: elm.elst,
            dr: elm.s_list[1],
            timelineStartInfo: {baseMediaDecodeTime: 0},
            bitrate: Math.floor(elm.s_sz.reduce(function(a, b){ return a+b; })*
                8*elm.ts/tr.media_box.md_hdr.duration),
            duration: elm.type=='soun' ?
                tr.media_box.md_hdr.duration :
                Math.floor(tr.media_box.md_hdr.duration*90000/elm.ts),
            matrix: tr.tk_hdr.matrix,
            track_width: tr.tk_hdr.width,
            samplerate: elm.type=='soun' ? elm.ts : 90000,
            track_height: tr.tk_hdr.height,
        };
        var dr = elm.s_list[1];
        if (elm.type=='soun')
        {
            event_elm.codec = 'mp4a.'+byte_to_hex(dr.esds.obj_t.toString(16))+
                (dr.esds.aot ? '.'+dr.esds.aot : '');
        }
        else
        {
            event_elm.codec = 'avc1.'+byte_to_hex(dr.avcc.avc_p_i)+
                byte_to_hex(dr.avcc.prof_compat)+byte_to_hex(dr.avcc.avc_l_i);
        }
        if (event_elm.edit_list)
        {
            event_elm.edit_list.forEach(function(e){
                if (elm.type!='soun')
                    e.media_time = Math.floor(e.media_time*90000/elm.ts);
                e.segment_duration = Math.floor(e.segment_duration*90000/
                    opt.root.movie_box.mv_hdr.time_scale);
            });
        }
        event.tracks.push(event_elm);
    });
    opt.stream.trigger('data', event);
};
Chunk_parser.prototype.parse = function(opt){
    if (!this.s_info)
        this.process(opt);
    var b_start = opt.buffer.b_pos;
    var b_end = opt.buffer.b_size+b_start;
    var pc = -1, max_dcd = 0, i;
    while (pc)
    {
        pc = 0;
        for (i=0; i<this.s_p.length; i++)
        {
            var sn = this.s_p[i].s;
            var pos = this.s_info[i].s_off[sn];
            var sz = this.s_info[i].s_sz[sn];
            var time = this.s_info[i].s_time;
            if (pos>=b_start && pos+sz<=b_end)
            {
                this.s_p[i].s++;
                pc++;
                var sample = {trackId: this.s_info[i].id};
                sample.type = sample_type[this.s_info[i].type];
                sample.dts = time[sn];
                sample.pts = sample.dts+(this.s_info[i].s_ctts[sn]||0);
                if (sn==time.length-1)
                    sample.duration = time[sn]-time[sn-1];
                else
                    sample.duration = time[sn+1]-time[sn];
                sample.size = sz;
                this.s_p[i].max_t = sample.dts/this.s_info[i].ts;
                sample.data = opt.buffer._buff.subarray(pos-b_start,
                    pos+sz-b_start);
                sample.dr = this.s_info[i].s_list[this.s_info[i].s_dri[sn]];
                sample.ts = this.s_info[i].ts;
                sample.synced = !this.s_info[i].s_sync.length||
                    this.s_info[i].s_sync.indexOf(sn+1)>-1;
                if (this.s_info[i].type=='vide'&&this.break_on_sync&&sn&&
                    !(sn%this.frag_size))
                {
                    opt.stream.flush();
                }
                opt.stream.trigger('data', sample);
                max_dcd = pos+sz-b_start;
            }
        }
    }
    if (max_dcd)
        opt.buffer.advance(max_dcd);
    var new_pos = Infinity;
    for (i=0; i<this.s_p.length; i++)
    {
        if (this.s_p[i].s==this.s_info[i].s_off.length)
        {
            this.s_p[i].finish = true;
            continue;
        }
        new_pos = Math.min(new_pos, this.s_info[i].s_off[this.s_p[i].s]);
    }
    if (new_pos==Infinity)
        opt.stream.flush();
    if (new_pos==Infinity || new_pos>=b_start&&new_pos<b_end)
        new_pos = b_end;
    return new_pos;
};
Chunk_parser.prototype.seek = function(time, use_ss){
    if (!this.s_info)
        throw new Error('No metadata information for seeking');
    var target = time*90000;
    var m_pos = Infinity;
    function get_frame(target, elm, use_ss){
        var l, r, sn, m, m_time, tt;
        var i_ss = use_ss&&elm.s_sync.length>0;
        var i_soun = elm.type=='soun';
        var scale = elm.ts/90000;
        l = 0;
        r = i_ss ? elm.s_sync.length-1 : elm.s_time.length-1;
        tt = Math.floor(target*scale);
        while (l<r-1)
        {
            m = (l+r)>>1;
            sn = i_ss ? elm.s_sync[m]-1 : m;
            if ((m_time = elm.s_time[sn]+(elm.s_ctts[sn]|0))>tt)
                r = m;
            else
            {
                l = m;
                if (m_time==tt)
                    break;
            }
        }
        var res_sn = i_ss ? elm.s_sync[l]-1 : l;
        tt = m_time = elm.s_time[res_sn]+(elm.s_ctts[res_sn]|0);
        if (!i_ss&&elm.s_ctts.length)
        {
            for (sn=l-1; sn>l-10; sn--)
            {
                if (elm.s_time[sn]+(elm.s_ctts[sn]|0)>tt)
                    res_sn = sn;
            }
            for (sn=res_sn; sn<l+10; sn++)
            {
                if ((m_time = elm.s_time[sn]+(elm.s_ctts[sn]|0))<tt)
                    tt = m_time;
            }
        }
        return {sn: res_sn, min_t: tt/elm.ts};
    }
    if (this.v_idx!==undefined)
    {
        var elm = this.s_info[this.v_idx];
        var v_fr = get_frame(target, elm, use_ss);
        var v_sn = v_fr.sn;
        this.s_p[this.v_idx].s = v_sn;
        this.s_p[this.v_idx].max_t =
            (elm.s_time[v_sn]+(elm.s_ctts[v_sn]|0))/elm.ts;
        // sync audio track(s) to video
        target = v_fr.min_t*90000;
        m_pos = elm.s_off[v_sn];
    }
    var _this = this;
    this.s_info.forEach(function(elm, idx){
        if (idx==_this.v_idx)
            return;
        var s_sn = get_frame(target, elm, use_ss).sn;
        _this.s_p[idx].s = s_sn;
        _this.s_p[idx].max_t = (elm.s_time[s_sn]+(elm.s_ctts[s_sn]|0))/elm.ts;
        m_pos = Math.min(elm.s_off[s_sn], m_pos);
    });
    return {
        offset: m_pos,
        time: this.s_p[this.v_idx!==undefined ? this.v_idx : 0].max_t,
    };
};

var Buffer = function(){
    this._buff = new Uint8Array(3*1048576);
    this.b_pos = 0;
    this.b_size = 0;
    this.pos = 0;
};
Buffer.prototype = {};
Buffer.prototype.advance = function(ptr){
    this._buff.set(this._buff.subarray(ptr, this.b_size));
    this.b_pos += ptr;
    this.b_size -= ptr;
};
Buffer.prototype.push = function(chunk){
    var _newbuff;
    var c_len = chunk.length;
    if (c_len+this.b_size>this._buff.length)
    {
        var _newbuff = new Uint8Array(2*this._buff.length);
        _newbuff.set(this._buff);
        this._buff = _newbuff;
    }
    if (this.pos<this.b_pos+this.b_size && this.pos+c_len>=this.b_pos)
    {
        _newbuff = new Uint8Array(Math.max(this.pos+c_len,
            this.b_pos+this.b_size)-Math.min(this.pos, this.b_pos));
        if (this.pos<=this.b_pos)
        {
            _newbuff.set(chunk);
            if (this.pos+c_len<this.b_pos+this.b_size)
            {
                _newbuff.set(this._buff.subarray(this.pos+c_len-this.b_pos,
                    this.b_size), c_len);
            }
        }
        else
        {
            _newbuff.set(this._buff.subarray(0, this.pos-this.b_pos));
            _newbuff.set(chunk, this.pos-this.b_pos);
        }
        this._buff.set(_newbuff);
        this.b_size = _newbuff.length;
        _newbuff = null;
        this.b_pos = Math.min(this.b_pos, this.pos);
    }
    else if (this.pos==this.b_pos+this.b_size)
    {
        this._buff.set(chunk, this.b_size);
        this.b_size += c_len;
    }
    else
    {
        this._buff.set(chunk);
        this.b_size = c_len;
        this.b_pos = this.pos;
    }
    this.view = new DataView(this._buff.buffer, this._buff.byteOffset,
        this.b_size);
};

var MP4ParserStream = function(opt){
    if (!(this instanceof MP4ParserStream))
        return new MP4ParserStream();
    MP4ParserStream.prototype.init.call(this);
    this.buffer = new Buffer();
    this.b_parser = new Box_parser();
    this.c_parser = new Chunk_parser(opt);
    this.metadata = {};
};
MP4ParserStream.prototype = new window.muxjs.Stream();
MP4ParserStream.prototype.constructor = MP4ParserStream;
MP4ParserStream.prototype.get_tl = function(id){
    if (!this.metadata.h_parsed)
        throw new Error('No metadata information for time map');
    var t_i = this.c_parser.s_info.filter(function(e){ return e.id==id; });
    if (!t_i.length)
        throw new Error('No track information for time map');
    return {
        offset: t_i[0].s_off.slice(0),
        time: t_i[0].s_time.map(function(e){ return e/t_i[0].ts; }),
    };
};
MP4ParserStream.prototype.push = function(chunk){
    this.buffer.push(chunk);
    var opt = {
        root: this.metadata,
        branch: this.metadata,
        buffer: this.buffer,
        view: this.buffer.view,
        stream: this,
        ptr: 0,
    };
    while (!this.metadata.h_parsed)
    {
        this.b_parser.header(opt);
        if (!opt.type || opt.size+opt.ptr>this.buffer.b_size)
            break;
        this.b_parser.parse(opt);
        opt.ptr += opt.size;
    }
    if (this.metadata.h_parsed)
        this.buffer.pos = this.c_parser.parse(opt);
    else
    {
        this.buffer.advance(opt.ptr-opt.offset);
        this.buffer.pos = opt.type=='mdat' ?
            opt.ptr+opt.size : this.buffer.b_pos+this.buffer.b_size;
    }
    return this.buffer.pos;
};
MP4ParserStream.prototype.seek = function(time, use_ssync){
    this.flush();
    var seek_info = this.c_parser.seek(time, use_ssync);
    this.buffer.pos = seek_info.offset;
    return seek_info;
};

var AudioFilterStream = function(){
    if (!(this instanceof AudioFilterStream))
        return new AudioFilterStream();
    AudioFilterStream.prototype.init.call(this);
};
AudioFilterStream.prototype = new window.muxjs.Stream();
AudioFilterStream.prototype.constructor = AudioFilterStream;
AudioFilterStream.prototype.push = function(packet){
    if (packet.type!='audio')
        return;
    var scale = 90000/packet.ts;
    packet.pts = Math.floor(packet.pts*scale);
    packet.dts = Math.floor(packet.dts*scale);
    this.trigger('data', {
        type: 'audio',
        samplerate: packet.dr.s_rate,
        samplesize: packet.dr.s_size,
        audioobjecttype: packet.dr.esds.aot,
        samplingfrequencyindex: packet.dr.esds.freq,
        channelcount: packet.dr.esds.channel,
        ts: packet.ts,
        dts: packet.dts,
        pts: packet.pts,
        data: new Uint8Array(packet.data),
    });
};

var VideoFilterStream = function(){
    if (!(this instanceof VideoFilterStream))
        return new VideoFilterStream();
    VideoFilterStream.prototype.init.call(this);
    this.synced = false;
    this.au = new Uint8Array([0x09, 0xF0]);
};
VideoFilterStream.prototype = new window.muxjs.Stream();
VideoFilterStream.prototype.constructor = VideoFilterStream;
VideoFilterStream.prototype.flush = function(){
    this.dr = null;
    this.synced = false;
    this.trigger('done');
};
VideoFilterStream.prototype.push = function(packet){
    if (packet.type!='video')
        return;
    var pos = 0, i;
    var view = new DataView(packet.data.buffer, packet.data.byteOffset,
        packet.data.byteLength);
    var scale = 90000/packet.ts;
    packet.pts = Math.floor(packet.pts*scale);
    packet.dts = Math.floor(packet.dts*scale);
    this.trigger('data', {
        trackId: packet.trackId,
        pts: packet.pts,
        dts: packet.dts,
        data: this.au,
        nalUnitType: 'access_unit_delimiter_rbsp',
    });
    if (this.dr!=packet.dr||!this.synced)
    {
        this.dr = packet.dr;
        // pseudo-nals for config info
        if (this.dr.avcc.n_sps)
        {
            for (i=0; i<this.dr.avcc.n_sps; i++)
            {
                this.trigger('data', {
                    trackId: packet.trackId,
                    pts: packet.pts,
                    dts: packet.dts,
                    nalUnitType: 'seq_parameter_set_rbsp',
                    data: this.dr.avcc.sps[i].nal,
                    config: {
                        profileIdc: this.dr.avcc.avc_p_i,
                        levelIdc: this.dr.avcc.avc_l_i,
                        profileCompatibility: this.dr.avcc.prof_compat,
                        width: this.dr.width,
                        height: this.dr.height,
                    },
                });
            }
        }
        if (this.dr.avcc.n_pps)
        {
            for (i=0; i<this.dr.avcc.n_pps; i++)
            {
                this.trigger('data', {
                    trackId: packet.trackId,
                    pts: packet.pts,
                    dts: packet.dts,
                    nalUnitType: 'pic_parameter_set_rbsp',
                    data: this.dr.avcc.pps[0].nal,
                });
            }
        }
        this.synced = true;
    }
    while (pos<packet.data.length)
    {
        var sz = view.getUint32(pos);
        var event = {
            trackId: packet.trackId,
            pts: packet.pts,
            dts: packet.dts,
            data: new Uint8Array(packet.data.subarray(pos+4, pos+sz+4)),
        };
        if ((event.data[0]&0x1f)==5)
            event.nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
        event.synced = !pos && packet.synced;
        pos += sz+4;
        this.trigger('data', event);
    }
};

var MP4BuilderStream = function(opt){
    if (!(this instanceof MP4BuilderStream))
        return new MP4BuilderStream();
    MP4BuilderStream.prototype.init.call(this);
    this.options = opt||{};
    this.tracks = {};
    this.inited = false;
    this.options.no_multi_init = true;
    this.options.major = new Uint8Array([105, 115, 111, 53]); // 'iso5'
    this.options.compatible = [new Uint8Array([105, 115, 111, 54])]; // 'iso6'
    this.options.set_duration = true;
};
MP4BuilderStream.prototype = new window.muxjs.Stream();
MP4BuilderStream.prototype.constructor = MP4BuilderStream;
MP4BuilderStream.prototype.push = function(packet){
    var sample;
    if (packet.type=='metadata')
    {
        this.metadata = packet;
        return;
    }
    var id = packet.trackId;
    this.tracks[id] = this.tracks[id]||{samples: [], seqno: 0, sc: 0};
    var sample = {
        duration: packet.duration,
        size: packet.size,
        dts: packet.dts,
        pts: packet.pts,
        data: new Uint8Array(packet.data),
    };
    if (packet.type=='video'){
        var scale = 90000/packet.ts;
        sample.duration = Math.floor(sample.duration*scale);
        sample.pts = Math.floor(sample.pts*scale);
        sample.dts = Math.floor(sample.dts*scale);
        sample.flags = {isNonSyncSample: 0};
        sample.compositionTimeOffset = sample.pts-sample.dts;
    }
    packet.data = null;
    this.tracks[id].samples.push(sample);
};
MP4BuilderStream.prototype.flush = function(){
    var moof, mdat, seg_sz, _this = this;
    if (!this.inited){
        // build and emit init segments
        this.inited = true;
        var inits = [];
        this.metadata.tracks.forEach(function(tr){
            switch (tr.type)
            {
            case 'video':
                tr.profileIdc = tr.dr.avcc.avc_p_i;
                tr.levelIdc = tr.dr.avcc.avc_l_i;
                tr.profileCompatibility = tr.dr.avcc.prof_compat;
                tr.width = tr.dr.width;
                tr.height = tr.dr.height;
                tr.sps = tr.dr.avcc.sps.map(function(e){ return e.nal; });
                tr.pps = tr.dr.avcc.pps.map(function(e){ return e.nal; });
                break;
            case 'audio':
                tr.samplerate = tr.dr.s_rate;
                tr.samplesize = tr.dr.s_size;
                tr.audioobjecttype = tr.dr.esds.aot;
                tr.samplingfrequencyindex = tr.dr.esds.freq;
                tr.channelcount = tr.dr.esds.channel;
            }
            inits.push({
                id: tr.id,
                buffer: muxjs.mp4.initSegment([tr], _this.options),
            });
        });
        this.trigger('data', {init: true, inits: inits});
    }
    for (var id in this.tracks)
    {
        var track = this.tracks[id];
        if (!track.samples.length)
            continue;
        seg_sz = track.samples.reduce(function(a, b){
            return a+b.data.length; }, 0);
        moof = muxjs.mp4.moof(++track.seqno, [{
            id: id,
            baseMediaDecodeTime: track.samples[0].dts,
            samples: track.samples,
            type: 'audio', // XXX pavelki: hack to skip sdtp generation
        }], _this.options);
        var segment = new Uint8Array(8+seg_sz+moof.length);
        var sd = new Uint8Array(seg_sz);
        var offset = 0;
        track.samples.forEach(function(sample){
            sd.set(sample.data, offset);
            offset += sample.data.length;
            sample.data = null;
        });
        mdat = muxjs.mp4.mdat(sd);
        segment.set(moof);
        segment.set(mdat, moof.length);
        sd = mdat = moof = null;
        this.tracks[id].sc += this.tracks[id].samples.length;
        this.trigger('data', {id: id, data: segment, sc: this.tracks[id].sc});
        this.tracks[id].samples = [];
    }
    this.trigger('done');
};

window.muxjs = window.muxjs||{};
window.muxjs.MP4ParserStream = MP4ParserStream;
window.muxjs.AudioFilterStream = AudioFilterStream;
window.muxjs.VideoFilterStream = VideoFilterStream;
window.muxjs.MP4BuilderStream = MP4BuilderStream;

})(this, this.muxjs);
// file:lib/mp4-generator.js
/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Functions that generate fragmented MP4s suitable for use with Media
 * Source Extensions.
 */
(function(window, muxjs, undefined) {
'use strict';

var box, dinf, esds, ftyp, edts, elst, mdat, mfhd, minf, moof, moov, mvex,
    mvhd, trak, tkhd, mdia, mdhd, hdlr, sdtp, stbl, stsd, styp, traf, trex,
    trun, types, MAJOR_BRAND, MINOR_VERSION, AVC1_BRAND, VIDEO_HDLR,
    AUDIO_HDLR, HDLR_TYPES, VMHD, SMHD, DREF, STCO, STSC, STSZ, STTS,
    Uint8Array, DataView;

Uint8Array = window.Uint8Array;
DataView = window.DataView;

// pre-calculate constants
(function() {
  var i;
  types = {
    avc1: [], // codingname
    avcC: [],
    btrt: [],
    dinf: [],
    dref: [],
    edts: [],
    elst: [],
    esds: [],
    ftyp: [],
    hdlr: [],
    mdat: [],
    mdhd: [],
    mdia: [],
    mfhd: [],
    minf: [],
    moof: [],
    moov: [],
    mp4a: [], // codingname
    mvex: [],
    mvhd: [],
    sdtp: [],
    smhd: [],
    stbl: [],
    stco: [],
    stsc: [],
    stsd: [],
    stsz: [],
    stts: [],
    styp: [],
    tfdt: [],
    tfhd: [],
    traf: [],
    trak: [],
    trun: [],
    trex: [],
    tkhd: [],
    vmhd: []
  };

  for (i in types) {
    if (types.hasOwnProperty(i)) {
      types[i] = [
        i.charCodeAt(0),
        i.charCodeAt(1),
        i.charCodeAt(2),
        i.charCodeAt(3)
      ];
    }
  }

  MAJOR_BRAND = new Uint8Array([
    'i'.charCodeAt(0),
    's'.charCodeAt(0),
    'o'.charCodeAt(0),
    'm'.charCodeAt(0)
  ]);
  AVC1_BRAND = new Uint8Array([
    'a'.charCodeAt(0),
    'v'.charCodeAt(0),
    'c'.charCodeAt(0),
    '1'.charCodeAt(0)
  ]);
  MINOR_VERSION = new Uint8Array([0, 0, 0, 1]);
  VIDEO_HDLR = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // pre_defined
    0x76, 0x69, 0x64, 0x65, // handler_type: 'vide'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x56, 0x69, 0x64, 0x65,
    0x6f, 0x48, 0x61, 0x6e,
    0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'VideoHandler'
  ]);
  AUDIO_HDLR = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // pre_defined
    0x73, 0x6f, 0x75, 0x6e, // handler_type: 'soun'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x53, 0x6f, 0x75, 0x6e,
    0x64, 0x48, 0x61, 0x6e,
    0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'SoundHandler'
  ]);
  HDLR_TYPES = {
    "video":VIDEO_HDLR,
    "audio": AUDIO_HDLR
  };
  DREF = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x01, // entry_count
    0x00, 0x00, 0x00, 0x0c, // entry_size
    0x75, 0x72, 0x6c, 0x20, // 'url' type
    0x00, // version 0
    0x00, 0x00, 0x01 // entry_flags
  ]);
  SMHD = new Uint8Array([
    0x00,             // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00,       // balance, 0 means centered
    0x00, 0x00        // reserved
  ]);
  STCO = new Uint8Array([
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00 // entry_count
  ]);
  STSC = STCO;
  STSZ = new Uint8Array([
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // sample_size
    0x00, 0x00, 0x00, 0x00, // sample_count
  ]);
  STTS = STCO;
  VMHD = new Uint8Array([
    0x00, // version
    0x00, 0x00, 0x01, // flags
    0x00, 0x00, // graphicsmode
    0x00, 0x00,
    0x00, 0x00,
    0x00, 0x00 // opcolor
  ]);
})();

function uint32_to_arr(num){
  return [num>>>24&255, num>>>16&255, num>>>8&255, num&255];
}

function uint16_to_arr(num){
  return [num>>>8&255, num&255];
}

box = function(type) {
  var
    payload = [],
    size = 0,
    i,
    result,
    view;

  for (i = 1; i < arguments.length; i++) {
    payload.push(arguments[i]);
  }

  i = payload.length;

  // calculate the total size we need to allocate
  while (i--) {
    size += payload[i].byteLength;
  }
  result = new Uint8Array(size + 8);
  view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  view.setUint32(0, result.byteLength);
  result.set(type, 4);

  // copy the payload into the result
  for (i = 0, size = 8; i < payload.length; i++) {
    result.set(payload[i], size);
    size += payload[i].byteLength;
  }
  return result;
};

dinf = function() {
  return box(types.dinf, box(types.dref, DREF));
};

edts = function(track) {
  return box(types.edts, elst(track));
};

elst = function(track) {
  var count = track.edit_list.length, i;
  var bytes = [
    0x00, // version
    0x00, 0x00, 0x00
  ].concat(uint32_to_arr(count)); // entries count
  for (i = 0; i < count; i++)
  {
    bytes = bytes.concat(uint32_to_arr(track.edit_list[i].segment_duration))
    .concat(uint32_to_arr(track.edit_list[i].media_time))
    .concat(uint16_to_arr(track.edit_list[i].media_rate))
    .concat(uint16_to_arr(0)); // reserved
  }
  return box(types.elst, new Uint8Array(bytes));
};

esds = function(track) {
  return box(types.esds, new Uint8Array([
    0x00, // version
    0x00, 0x00, 0x00, // flags

    // ES_Descriptor
    0x03, // tag, ES_DescrTag
    0x19, // length
    0x00, 0x00, // ES_ID
    0x00, // streamDependenceFlag, URL_flag, reserved, streamPriority

    // DecoderConfigDescriptor
    0x04, // tag, DecoderConfigDescrTag
    0x11, // length
    0x40, // object type
    0x15,  // streamType
    0x00, 0x06, 0x00, // bufferSizeDB
    0x00, 0x00, 0xda, 0xc0, // maxBitrate
    0x00, 0x00, 0xda, 0xc0, // avgBitrate

    // DecoderSpecificInfo
    0x05, // tag, DecoderSpecificInfoTag
    0x02, // length
    // ISO/IEC 14496-3, AudioSpecificConfig
    // for samplingFrequencyIndex see ISO/IEC 13818-7:2006, 8.1.3.2.2, Table 35
    (track.audioobjecttype << 3) | (track.samplingfrequencyindex >>> 1),
    (track.samplingfrequencyindex << 7) | (track.channelcount << 3),
    0x06, 0x01, 0x02 // GASpecificConfig
  ]));
};

ftyp = function(opt) {
    opt = opt||{};
    var params = opt.compatible||[MAJOR_BRAND, AVC1_BRAND];
    params = params.slice(0);
    params.unshift(types.ftyp, opt.major||MAJOR_BRAND, MINOR_VERSION);
    return box.apply(null, params);
};

hdlr = function(type) {
  return box(types.hdlr, HDLR_TYPES[type]);
};
mdat = function(data) {
  return box(types.mdat, data);
};
mdhd = function(track) {
  var result = new Uint8Array([
    0x00,                   // version 0
    0x00, 0x00, 0x00,       // flags
    0x00, 0x00, 0x00, 0x02, // creation_time
    0x00, 0x00, 0x00, 0x03, // modification_time
    0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second

    (track.duration >>> 24) & 0xFF,
    (track.duration >>> 16) & 0xFF,
    (track.duration >>>  8) & 0xFF,
    track.duration & 0xFF,  // duration
    0x55, 0xc4,             // 'und' language (undetermined)
    0x00, 0x00
  ]);

  // Use the sample rate from the track metadata, when it is
  // defined. The sample rate can be parsed out of an ADTS header, for
  // instance.
  if (track.samplerate) {
    result[12] = (track.samplerate >>> 24) & 0xFF;
    result[13] = (track.samplerate >>> 16) & 0xFF;
    result[14] = (track.samplerate >>>  8) & 0xFF;
    result[15] = (track.samplerate)        & 0xFF;
  }

  return box(types.mdhd, result);
};
mdia = function(track) {
  return box(types.mdia, mdhd(track), hdlr(track.type), minf(track));
};
mfhd = function(sequenceNumber) {
  return box(types.mfhd, new Uint8Array([
    0x00,
    0x00, 0x00, 0x00, // flags
    (sequenceNumber & 0xFF000000) >> 24,
    (sequenceNumber & 0xFF0000) >> 16,
    (sequenceNumber & 0xFF00) >> 8,
    sequenceNumber & 0xFF, // sequence_number
  ]));
};
minf = function(track) {
  return box(types.minf,
    track.type === 'video' ? box(types.vmhd, VMHD) : box(types.smhd, SMHD),
    dinf(), stbl(track));
};
moof = function(sequenceNumber, tracks, opt) {
  var
    trackFragments = [],
    i = tracks.length;
  opt = opt||{};
  // build traf boxes for each track fragment
  while (i--) {
    trackFragments[i] = traf(tracks[i], opt);
  }
  return box.apply(null, [
    types.moof,
    mfhd(sequenceNumber)
  ].concat(trackFragments));
};
/**
 * Returns a movie box.
 * @param tracks {array} the tracks associated with this movie
 * @see ISO/IEC 14496-12:2012(E), section 8.2.1
 */
moov = function(tracks, opt) {
  var
    i = tracks.length,
    boxes = [],
    duration = 0;
  opt = opt||{};
  while (i--) {
    boxes[i] = trak(tracks[i]);
    if (opt.set_duration)
      duration = Math.max(duration,
          Math.floor(tracks[i].duration*90000/tracks[i].samplerate));
  }
  duration = opt.duration||duration||0xFFFFFFFF;
  return box.apply(null, [types.moov, mvhd(duration)].concat(boxes)
      .concat(mvex(tracks)));
};
mvex = function(tracks) {
  var
    i = tracks.length,
    boxes = [];

  while (i--) {
    boxes[i] = trex(tracks[i]);
  }
  return box.apply(null, [types.mvex].concat(boxes));
};
mvhd = function(duration) {
  var
    bytes = new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x01, // creation_time
      0x00, 0x00, 0x00, 0x02, // modification_time
      0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second
      (duration & 0xFF000000) >> 24,
      (duration & 0xFF0000) >> 16,
      (duration & 0xFF00) >> 8,
      duration & 0xFF, // duration
      0x00, 0x01, 0x00, 0x00, // 1.0 rate
      0x01, 0x00, // 1.0 volume
      0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // pre_defined
      0xff, 0xff, 0xff, 0xff // next_track_ID
    ]);
  return box(types.mvhd, bytes);
};

sdtp = function(track) {
  var
    samples = track.samples || [],
    bytes = new Uint8Array(4 + samples.length),
    flags,
    i;

  // leave the full box header (4 bytes) all zero

  // write the sample table
  for (i = 0; i < samples.length; i++) {
    flags = samples[i].flags;

    bytes[i + 4] = (flags.dependsOn << 4) |
      (flags.isDependedOn << 2) |
      (flags.hasRedundancy);
  }

  return box(types.sdtp,
             bytes);
};

stbl = function(track) {
  return box(types.stbl,
             stsd(track),
             box(types.stts, STTS),
             box(types.stsc, STSC),
             box(types.stsz, STSZ),
             box(types.stco, STCO));
};

(function() {
  var videoSample, audioSample;

  stsd = function(track) {

    return box(types.stsd, new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x01
    ]), track.type === 'video' ? videoSample(track) : audioSample(track));
  };

  videoSample = function(track) {
    var
      sps = track.sps || [],
      pps = track.pps || [],
      sequenceParameterSets = [],
      pictureParameterSets = [],
      i;

    // assemble the SPSs
    for (i = 0; i < sps.length; i++) {
      sequenceParameterSets.push((sps[i].byteLength & 0xFF00) >>> 8);
      sequenceParameterSets.push((sps[i].byteLength & 0xFF)); // sequenceParameterSetLength
      sequenceParameterSets = sequenceParameterSets.concat(Array.prototype.slice.call(sps[i])); // SPS
    }

    // assemble the PPSs
    for (i = 0; i < pps.length; i++) {
      pictureParameterSets.push((pps[i].byteLength & 0xFF00) >>> 8);
      pictureParameterSets.push((pps[i].byteLength & 0xFF));
      pictureParameterSets = pictureParameterSets.concat(Array.prototype.slice.call(pps[i]));
    }

    return box(types.avc1, new Uint8Array([
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data_reference_index
      0x00, 0x00, // pre_defined
      0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // pre_defined
      (track.width & 0xff00) >> 8,
      track.width & 0xff, // width
      (track.height & 0xff00) >> 8,
      track.height & 0xff, // height
      0x00, 0x48, 0x00, 0x00, // horizresolution
      0x00, 0x48, 0x00, 0x00, // vertresolution
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // frame_count
      0x13,
      0x76, 0x69, 0x64, 0x65,
      0x6f, 0x6a, 0x73, 0x2d,
      0x63, 0x6f, 0x6e, 0x74,
      0x72, 0x69, 0x62, 0x2d,
      0x68, 0x6c, 0x73, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, // compressorname
      0x00, 0x18, // depth = 24
      0x11, 0x11 // pre_defined = -1
    ]), box(types.avcC, new Uint8Array([
      0x01, // configurationVersion
      track.profileIdc, // AVCProfileIndication
      track.profileCompatibility, // profile_compatibility
      track.levelIdc, // AVCLevelIndication
      0xff // lengthSizeMinusOne, hard-coded to 4 bytes
    ].concat([
      sps.length|0xE0 // reserved (high 3 bits) | numOfSequenceParameterSets
    ]).concat(sequenceParameterSets).concat([
      pps.length // numOfPictureParameterSets
    ]).concat(pictureParameterSets))), // "PPS"
            box(types.btrt, new Uint8Array([
              0x00, 0x1c, 0x9c, 0x80, // bufferSizeDB
              0x00, 0x2d, 0xc6, 0xc0, // maxBitrate
              0x00, 0x2d, 0xc6, 0xc0
            ])) // avgBitrate
              );
  };

  audioSample = function(track) {
    return box(types.mp4a, new Uint8Array([

      // SampleEntry, ISO/IEC 14496-12
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data_reference_index

      // AudioSampleEntry, ISO/IEC 14496-12
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      (track.channelcount & 0xff00) >> 8,
      (track.channelcount & 0xff), // channelcount

      (track.samplesize & 0xff00) >> 8,
      (track.samplesize & 0xff), // samplesize
      0x00, 0x00, // pre_defined
      0x00, 0x00, // reserved

      (track.samplerate & 0xff00) >> 8,
      (track.samplerate & 0xff),
      0x00, 0x00 // samplerate, 16.16

      // MP4AudioSampleEntry, ISO/IEC 14496-14
    ]), esds(track));
  };
})();

styp = function() {
  return box(types.styp, MAJOR_BRAND, MINOR_VERSION, MAJOR_BRAND);
};

tkhd = function(track) {
  var duration = track.duration;
  if (track.samplerate) {
    // tkhd duration should be in movie scale
    duration = Math.floor(duration*90000/track.samplerate);
  }
  var result = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x07, // flags
    0x00, 0x00, 0x00, 0x00, // creation_time
    0x00, 0x00, 0x00, 0x00, // modification_time
    (track.id & 0xFF000000) >> 24,
    (track.id & 0xFF0000) >> 16,
    (track.id & 0xFF00) >> 8,
    track.id & 0xFF, // track_ID
    0x00, 0x00, 0x00, 0x00, // reserved
    (track.duration & 0xFF000000) >> 24,
    (track.duration & 0xFF0000) >> 16,
    (track.duration & 0xFF00) >> 8,
    track.duration & 0xFF, // duration
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, // layer
    0x00, 0x00, // alternate_group
    +(track.type=='audio'), 0x00, // track volume, should be 0 for video
    0x00, 0x00, // reserved
    0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
    (track.width & 0xFF00) >> 8,
    track.width & 0xFF,
    0x00, 0x00, // width
    (track.height & 0xFF00) >> 8,
    track.height & 0xFF,
    0x00, 0x00 // height
  ]);

  return box(types.tkhd, result);
};

/**
 * Generate a track fragment (traf) box. A traf box collects metadata
 * about tracks in a movie fragment (moof) box.
 */
traf = function(track, opt) {
  var trackFragmentHeader, trackFragmentDecodeTime,
      trackFragmentRun, sampleDependencyTable, dataOffset;
  opt = opt||{};
  trackFragmentHeader = box(types.tfhd, new Uint8Array([
    0x00, // version 0
    opt.no_multi_init ? 0x02 : 0x00, 0x00, 0x3a, // flags
    (track.id & 0xFF000000) >> 24,
    (track.id & 0xFF0000) >> 16,
    (track.id & 0xFF00) >> 8,
    (track.id & 0xFF), // track_ID
    0x00, 0x00, 0x00, 0x01, // sample_description_index
    0x00, 0x00, 0x00, 0x00, // default_sample_duration
    0x00, 0x00, 0x00, 0x00, // default_sample_size
    0x00, 0x00, 0x00, 0x00  // default_sample_flags
  ]));

  trackFragmentDecodeTime = box(types.tfdt, new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    // baseMediaDecodeTime
    (track.baseMediaDecodeTime >>> 24) & 0xFF,
    (track.baseMediaDecodeTime >>> 16) & 0xFF,
    (track.baseMediaDecodeTime >>> 8) & 0xFF,
    track.baseMediaDecodeTime & 0xFF
  ]));

  // the data offset specifies the number of bytes from the start of
  // the containing moof to the first payload byte of the associated
  // mdat
  dataOffset = (32 + // tfhd
                16 + // tfdt
                8 +  // traf header
                16 + // mfhd
                8 +  // moof header
                8);  // mdat header

  // audio tracks require less metadata
  if (track.type === 'audio') {
    trackFragmentRun = trun(track, dataOffset);
    return box(types.traf,
               trackFragmentHeader,
               trackFragmentDecodeTime,
               trackFragmentRun);
  }

  // video tracks should contain an independent and disposable samples
  // box (sdtp)
  // generate one and adjust offsets to match
  sampleDependencyTable = sdtp(track);
  trackFragmentRun = trun(track,
                          sampleDependencyTable.length + dataOffset);
  return box(types.traf,
             trackFragmentHeader,
             trackFragmentDecodeTime,
             trackFragmentRun,
             sampleDependencyTable);
};

/**
 * Generate a track box.
 * @param track {object} a track definition
 * @return {Uint8Array} the track box
 */
trak = function(track) {
  track.duration = track.duration || 0xffffffff;
  var param = [types.trak, tkhd(track), mdia(track)];
  if (track.edit_list && track.edit_list.length)
      param.splice(2, 0, edts(track));
  return box.apply(null, param);
};

trex = function(track) {
  var result = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    (track.id & 0xFF000000) >> 24,
    (track.id & 0xFF0000) >> 16,
    (track.id & 0xFF00) >> 8,
    (track.id & 0xFF), // track_ID
    0x00, 0x00, 0x00, 0x01, // default_sample_description_index
    0x00, 0x00, 0x00, 0x00, // default_sample_duration
    0x00, 0x00, 0x00, 0x00, // default_sample_size
    0x00, 0x01, 0x00, 0x01 // default_sample_flags
  ]);
  // the last two bytes of default_sample_flags is the sample
  // degradation priority, a hint about the importance of this sample
  // relative to others. Lower the degradation priority for all sample
  // types other than video.
  if (track.type !== 'video') {
    result[result.length - 1] = 0x00;
  }

  return box(types.trex, result);
};

trun = function(track, offset) {
  function get_flags(sample){
    return ('duration' in sample&&0x1)|('size' in sample&&0x2)|
        ('flags' in sample&&0x4)|('compositionTimeOffset' in sample&&0x8);
  }
  function trun_header(samples, offset, flags) {
    return [
      0x00, // version 0
      0x00,
      flags,
      0x01, // flags
      (samples.length & 0xFF000000) >>> 24,
      (samples.length & 0xFF0000) >>> 16,
      (samples.length & 0xFF00) >>> 8,
      samples.length & 0xFF, // sample_count
      (offset & 0xFF000000) >>> 24,
      (offset & 0xFF0000) >>> 16,
      (offset & 0xFF00) >>> 8,
      offset & 0xFF // data_offset
    ];
  }
  var samples = track.samples||[];
  var flags = get_flags(samples[0]||{});
  offset += 20+4*samples.length*((flags>>3&1)+(flags>>2&1)+(flags>>1&1)+
    (flags&1));
  var bytes = trun_header(samples, offset, flags);
  for (var i=0; i<samples.length; i++) {
    var sample = samples[i];
    if (flags&1){
      bytes.push(sample.duration>>24&0xFF, sample.duration>>16&0xFF,
        sample.duration>>8&0xFF, sample.duration&0xFF); // sample_duration
    }
    if (flags&2){
      bytes.push(sample.size>>24&0xFF, sample.size>>16&0xFF,
        sample.size>>8&0xFF, sample.size&0xFF); // sample_size
    }
    if (flags&4){
      bytes.push(sample.flags.isLeading<<2|sample.flags.dependsOn,
        sample.flags.isDependedOn<<6|sample.flags.hasRedundancy<<4|
        sample.flags.paddingValue<<1|sample.flags.isNonSyncSample,
        sample.flags.degradationPriority>>8&0xFF,
        sample.flags.degradationPriority&0xFF); // sample_flags
    }
    if (flags&8){
      bytes.push(sample.compositionTimeOffset>>24&0xFF,
        sample.compositionTimeOffset>>16&0xFF,
        sample.compositionTimeOffset>>8&0xFF,
        sample.compositionTimeOffset&0xFF); // sample_composition_time_offset
    }
  }
  return box(types.trun, new Uint8Array(bytes));
};

muxjs.mp4 = {
  ftyp: ftyp,
  mdat: mdat,
  moof: moof,
  moov: moov,
  initSegment: function(tracks, opt) {
    var
      fileType = ftyp(opt),
      movie = moov(tracks, opt),
      result;

    result = new Uint8Array(fileType.byteLength + movie.byteLength);
    result.set(fileType);
    result.set(movie, fileType.byteLength);
    return result;
  }
};

})(this, this.muxjs);
// file:lib/transmuxer.js
/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * A stream-based mp2t to mp4 converter. This utility can be used to
 * deliver mp4s to a SourceBuffer on platforms that support native
 * Media Source Extensions.
 */
(function(window, muxjs, undefined) {
'use strict';

// object types
var TransportPacketStream, TransportParseStream, ElementaryStream,
    VideoSegmentStream, AudioSegmentStream, Transmuxer, AacStream,
    H264Stream, NalByteStream, CoalesceStream;

// Helper functions
var collectDtsInfo, clearDtsInfo, calculateTrackBaseMediaDecodeTime;

// constants
var MP2T_PACKET_LENGTH, H264_STREAM_TYPE, ADTS_STREAM_TYPE,
    METADATA_STREAM_TYPE, ADTS_SAMPLING_FREQUENCIES, SYNC_BYTE;

// namespace
var mp4;

MP2T_PACKET_LENGTH = 188; // bytes
SYNC_BYTE = 0x47;

H264_STREAM_TYPE = 0x1b;
ADTS_STREAM_TYPE = 0x0f;
METADATA_STREAM_TYPE = 0x15;

ADTS_SAMPLING_FREQUENCIES = [
  96000,
  88200,
  64000,
  48000,
  44100,
  32000,
  24000,
  22050,
  16000,
  12000,
  11025,
  8000,
  7350
];

mp4 = muxjs.mp4;

/**
 * Splits an incoming stream of binary data into MPEG-2 Transport
 * Stream packets.
 */
TransportPacketStream = function() {
  var
    buffer = new Uint8Array(MP2T_PACKET_LENGTH),
    bytesInBuffer = 0;

  TransportPacketStream.prototype.init.call(this);

   // Deliver new bytes to the stream.

  this.push = function(bytes) {
    var
      i = 0,
      startIndex = 0,
      endIndex = MP2T_PACKET_LENGTH,
      everything;

    // If there are bytes remaining from the last segment, prepend them to the
    // bytes that were pushed in
    if (bytesInBuffer) {
      everything = new Uint8Array(bytes.byteLength + bytesInBuffer);
      everything.set(buffer);
      everything.set(bytes, bytesInBuffer);
      bytesInBuffer = 0;
    } else {
      everything = bytes;
    }

    // While we have enough data for a packet
    while (endIndex < everything.byteLength) {
      // Look for a pair of start and end sync bytes in the data..
      if (everything[startIndex] === SYNC_BYTE && everything[endIndex] === SYNC_BYTE) {
        // We found a packet so emit it and jump one whole packet forward in
        // the stream
        this.trigger('data', everything.subarray(startIndex, endIndex));
        startIndex += MP2T_PACKET_LENGTH;
        endIndex += MP2T_PACKET_LENGTH;
        continue;
      }
      // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet
      startIndex++;
      endIndex++;
    }

    // If there was some data left over at the end of the segment that couldn't
    // possibly be a whole packet, keep it because it might be the start of a packet
    // that continues in the next segment
    if (startIndex < everything.byteLength) {
      buffer.set(everything.subarray(startIndex), 0);
      bytesInBuffer = everything.byteLength - startIndex;
    }
  };

  this.flush = function () {
    // If the buffer contains a whole packet when we are being flushed, emit it
    // and empty the buffer. Otherwise hold onto the data because it may be
    // important for decoding the next segment
    if (bytesInBuffer === MP2T_PACKET_LENGTH && buffer[0] === SYNC_BYTE) {
      this.trigger('data', buffer);
      bytesInBuffer = 0;
    }
    this.trigger('done');
  };
};
TransportPacketStream.prototype = new muxjs.Stream();

/**
 * Accepts an MP2T TransportPacketStream and emits data events with parsed
 * forms of the individual transport stream packets.
 */
TransportParseStream = function() {
  var parsePsi, parsePat, parsePmt, parsePes, self;
  TransportParseStream.prototype.init.call(this);
  self = this;

  this.packetsWaitingForPmt = [];
  this.programMapTable = undefined;

  parsePsi = function(payload, psi) {
    var offset = 0;

    // PSI packets may be split into multiple sections and those
    // sections may be split into multiple packets. If a PSI
    // section starts in this packet, the payload_unit_start_indicator
    // will be true and the first byte of the payload will indicate
    // the offset from the current position to the start of the
    // section.
    if (psi.payloadUnitStartIndicator) {
      offset += payload[offset] + 1;
    }

    if (psi.type === 'pat') {
      parsePat(payload.subarray(offset), psi);
    } else {
      parsePmt(payload.subarray(offset), psi);
    }
  };

  parsePat = function(payload, pat) {
    pat.section_number = payload[7];
    pat.last_section_number = payload[8];

    // skip the PSI header and parse the first PMT entry
    self.pmtPid = (payload[10] & 0x1F) << 8 | payload[11];
    pat.pmtPid = self.pmtPid;
  };

  /**
   * Parse out the relevant fields of a Program Map Table (PMT).
   * @param payload {Uint8Array} the PMT-specific portion of an MP2T
   * packet. The first byte in this array should be the table_id
   * field.
   * @param pmt {object} the object that should be decorated with
   * fields parsed from the PMT.
   */
  parsePmt = function(payload, pmt) {
    var sectionLength, tableEnd, programInfoLength, offset;

    // PMTs can be sent ahead of the time when they should actually
    // take effect. We don't believe this should ever be the case
    // for HLS but we'll ignore "forward" PMT declarations if we see
    // them. Future PMT declarations have the current_next_indicator
    // set to zero.
    if (!(payload[5] & 0x01)) {
      return;
    }

    // overwrite any existing program map table
    self.programMapTable = {};

    // the mapping table ends at the end of the current section
    sectionLength = (payload[1] & 0x0f) << 8 | payload[2];
    tableEnd = 3 + sectionLength - 4;

    // to determine where the table is, we have to figure out how
    // long the program info descriptors are
    programInfoLength = (payload[10] & 0x0f) << 8 | payload[11];

    // advance the offset to the first entry in the mapping table
    offset = 12 + programInfoLength;
    while (offset < tableEnd) {
      // add an entry that maps the elementary_pid to the stream_type
      self.programMapTable[(payload[offset + 1] & 0x1F) << 8 | payload[offset + 2]] = payload[offset];

      // move to the next table entry
      // skip past the elementary stream descriptors, if present
      offset += ((payload[offset + 3] & 0x0F) << 8 | payload[offset + 4]) + 5;
    }

    // record the map on the packet as well
    pmt.programMapTable = self.programMapTable;

    // if there are any packets waiting for a PMT to be found, process them now
    while (self.packetsWaitingForPmt.length) {
      self.processPes_.apply(self, self.packetsWaitingForPmt.shift());
    }
  };

  parsePes = function(payload, pes) {
    var ptsDtsFlags;

    if (!pes.payloadUnitStartIndicator) {
      pes.data = payload;
      return;
    }

    // find out if this packets starts a new keyframe
    pes.dataAlignmentIndicator = (payload[6] & 0x04) !== 0;
    // PES packets may be annotated with a PTS value, or a PTS value
    // and a DTS value. Determine what combination of values is
    // available to work with.
    ptsDtsFlags = payload[7];

    // PTS and DTS are normally stored as a 33-bit number.  Javascript
    // performs all bitwise operations on 32-bit integers but javascript
    // supports a much greater range (52-bits) of integer using standard
    // mathematical operations.
    // We construct a 32-bit value using bitwise operators over the 32
    // most significant bits and then multiply by 2 (equal to a left-shift
    // of 1) before we add the final LSB of the timestamp (equal to an OR.)
    if (ptsDtsFlags & 0xC0) {
      // the PTS and DTS are not written out directly. For information
      // on how they are encoded, see
      // http://dvd.sourceforge.net/dvdinfo/pes-hdr.html
      pes.pts = (payload[9] & 0x0E) << 28
        | (payload[10] & 0xFF) << 21
        | (payload[11] & 0xFE) << 13
        | (payload[12] & 0xFF) <<  6
        | (payload[13] & 0xFE) >>>  2;
      pes.pts *= 2; // Left shift by 1
      pes.pts += (payload[13] & 0x02); // OR by the LSB
      pes.dts = pes.pts;
      if (ptsDtsFlags & 0x40) {
        pes.dts = (payload[14] & 0x0E ) << 28
          | (payload[15] & 0xFF ) << 21
          | (payload[16] & 0xFE ) << 13
          | (payload[17] & 0xFF ) << 6
          | (payload[18] & 0xFE ) >>> 2;
        pes.dts *= 2; // Left shift by 1
        pes.dts += (payload[18] & 0x02); // OR by the LSB
      }
    }

    // the data section starts immediately after the PES header.
    // pes_header_data_length specifies the number of header bytes
    // that follow the last byte of the field.
    pes.data = payload.subarray(9 + payload[8]);
  };

  /**
   * Deliver a new MP2T packet to the stream.
   */
  this.push = function(packet) {
    var
      result = {},
      offset = 4;

    result.payloadUnitStartIndicator = !!(packet[1] & 0x40);

    // pid is a 13-bit field starting at the last bit of packet[1]
    result.pid = packet[1] & 0x1f;
    result.pid <<= 8;
    result.pid |= packet[2];

    // if an adaption field is present, its length is specified by the
    // fifth byte of the TS packet header. The adaptation field is
    // used to add stuffing to PES packets that don't fill a complete
    // TS packet, and to specify some forms of timing and control data
    // that we do not currently use.
    if (((packet[3] & 0x30) >>> 4) > 0x01) {
      offset += packet[offset] + 1;
    }

    // parse the rest of the packet based on the type
    if (result.pid === 0) {
      result.type = 'pat';
      parsePsi(packet.subarray(offset), result);
      this.trigger('data', result);
    } else if (result.pid === this.pmtPid) {
      result.type = 'pmt';
      parsePsi(packet.subarray(offset), result);
      this.trigger('data', result);
    } else if (this.programMapTable === undefined) {
      this.packetsWaitingForPmt.push([packet, offset, result]);
    } else {
      this.processPes_(packet, offset, result);
    }
  };

  this.processPes_ = function (packet, offset, result) {
    result.streamType = this.programMapTable[result.pid];
    result.type = 'pes';
    parsePes(packet.subarray(offset), result);

    this.trigger('data', result);
  };

};
TransportParseStream.prototype = new muxjs.Stream();
TransportParseStream.STREAM_TYPES  = {
  h264: 0x1b,
  adts: 0x0f
};

/**
 * Reconsistutes program elementary stream (PES) packets from parsed
 * transport stream packets. That is, if you pipe an
 * mp2t.TransportParseStream into a mp2t.ElementaryStream, the output
 * events will be events which capture the bytes for individual PES
 * packets plus relevant metadata that has been extracted from the
 * container.
 */
ElementaryStream = function() {
  var
    // PES packet fragments
    video = {
      data: [],
      size: 0
    },
    audio = {
      data: [],
      size: 0
    },
    timedMetadata = {
      data: [],
      size: 0
    },
    flushStream = function(stream, type) {
      var
        event = {
          type: type,
          data: new Uint8Array(stream.size),
        },
        i = 0,
        fragment;

      // do nothing if there is no buffered data
      if (!stream.data.length) {
        return;
      }
      event.trackId = stream.data[0].pid;
      event.pts = stream.data[0].pts;
      event.dts = stream.data[0].dts;

      // reassemble the packet
      while (stream.data.length) {
        fragment = stream.data.shift();

        event.data.set(fragment.data, i);
        i += fragment.data.byteLength;
      }
      stream.size = 0;

      self.trigger('data', event);
    },
    self;

  ElementaryStream.prototype.init.call(this);
  self = this;

  this.push = function(data) {
    ({
      pat: function() {
        // we have to wait for the PMT to arrive as well before we
        // have any meaningful metadata
      },
      pes: function() {
        var stream, streamType;

        switch (data.streamType) {
        case H264_STREAM_TYPE:
          stream = video;
          streamType = 'video';
          break;
        case ADTS_STREAM_TYPE:
          stream = audio;
          streamType = 'audio';
          break;
        case METADATA_STREAM_TYPE:
          stream = timedMetadata;
          streamType = 'timed-metadata';
          break;
        default:
          // ignore unknown stream types
          return;
        }

        // if a new packet is starting, we can flush the completed
        // packet
        if (data.payloadUnitStartIndicator) {
          flushStream(stream, streamType);
        }

        // buffer this fragment until we are sure we've received the
        // complete payload
        stream.data.push(data);
        stream.size += data.data.byteLength;
      },
      pmt: function() {
        var
          event = {
            type: 'metadata',
            tracks: []
          },
          programMapTable = data.programMapTable,
          k,
          track;

        // translate streams to tracks
        for (k in programMapTable) {
          if (programMapTable.hasOwnProperty(k)) {
            track = {
              timelineStartInfo: {}
            };
            track.id = +k;
            if (programMapTable[k] === H264_STREAM_TYPE) {
              track.codec = 'avc';
              track.type = 'video';
            } else if (programMapTable[k] === ADTS_STREAM_TYPE) {
              track.codec = 'adts';
              track.type = 'audio';
            }
            event.tracks.push(track);
          }
        }
        self.trigger('data', event);
      }
    })[data.type]();
  };

  /**
   * Flush any remaining input. Video PES packets may be of variable
   * length. Normally, the start of a new video packet can trigger the
   * finalization of the previous packet. That is not possible if no
   * more video is forthcoming, however. In that case, some other
   * mechanism (like the end of the file) has to be employed. When it is
   * clear that no additional data is forthcoming, calling this method
   * will flush the buffered packets.
   */
  this.flush = function() {
    // !!THIS ORDER IS IMPORTANT!!
    // video first then audio
    flushStream(video, 'video');
    flushStream(audio, 'audio');
    flushStream(timedMetadata, 'timed-metadata');
    this.trigger('done');
  };
};
ElementaryStream.prototype = new muxjs.Stream();

/*
 * Accepts a ElementaryStream and emits data events with parsed
 * AAC Audio Frames of the individual packets. Input audio in ADTS
 * format is unpacked and re-emitted as AAC frames.
 *
 * @see http://wiki.multimedia.cx/index.php?title=ADTS
 * @see http://wiki.multimedia.cx/?title=Understanding_AAC
 */
AacStream = function() {
  var i = 0, self, buffer;
  AacStream.prototype.init.call(this);
  self = this;

  this.push = function(packet) {
    var frameLength, protectionSkipBytes, frameEnd, oldBuffer, numFrames;

    if (packet.type !== 'audio') {
      // ignore non-audio data
      return;
    }

    // Prepend any data in the buffer to the input data so that we can parse
    // aac frames the cross a PES packet boundary
    if (buffer) {
      oldBuffer = buffer;
      buffer = new Uint8Array(oldBuffer.byteLength + packet.data.byteLength);
      buffer.set(oldBuffer);
      buffer.set(packet.data, oldBuffer.byteLength);
    } else {
      buffer = packet.data;
    }

    // unpack any ADTS frames which have been fully received
    // for details on the ADTS header, see http://wiki.multimedia.cx/index.php?title=ADTS
    while (i + 5 < buffer.length) {

      // Loook for the start of an ADTS header..
      if (buffer[i] !== 0xFF || (buffer[i + 1] & 0xF6) !== 0xF0) {
        // If a valid header was not found,  jump one forward and attempt to
        // find a valid ADTS header starting at the next byte
        i++;
        continue;
      }

      // The protection skip bit tells us if we have 2 bytes of CRC data at the
      // end of the ADTS header
      protectionSkipBytes = (~buffer[i + 1] & 0x01) * 2;

      // Frame length is a 13 bit integer starting 16 bits from the
      // end of the sync sequence
      frameLength = ((buffer[i + 3] & 0x03) << 11) |
        (buffer[i + 4] << 3) |
        ((buffer[i + 5] & 0xe0) >> 5);

      frameEnd = i + frameLength;

      // If we don't have enough data to actually finish this AAC frame, return
      // and wait for more data
      if (buffer.byteLength < frameEnd) {
        return;
      }

      // Otherwise, deliver the complete AAC frame
      this.trigger('data', {
        dts: packet.dts,
        audioobjecttype: ((buffer[i + 2] >>> 6) & 0x03) + 1,
        channelcount: ((buffer[i + 2] & 1) << 3) |
          ((buffer[i + 3] & 0xc0) >>> 6),
        samplerate: ADTS_SAMPLING_FREQUENCIES[(buffer[i + 2] & 0x3c) >>> 2],
        samplingfrequencyindex: (buffer[i + 2] & 0x3c) >>> 2,
        // assume ISO/IEC 14496-12 AudioSampleEntry default of 16
        samplesize: 16,
        data: buffer.subarray(i + 7 + protectionSkipBytes, frameEnd)
      });

      // If the buffer is empty, clear it and return
      if (buffer.byteLength === frameEnd) {
        buffer = undefined;
        return;
      }

      // Remove the finished frame from the buffer and start the process again
      buffer = buffer.subarray(frameEnd);
      i = 0;
    }
  };
};

AacStream.prototype = new muxjs.Stream();

/**
 * Constructs a single-track, ISO BMFF media segment from AAC data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 */
// TODO: share common code with VideoSegmentStream
AudioSegmentStream = function(track) {
  var
    aacFrames = [],
    aacFramesLength = 0,
    sequenceNumber = 0,
    earliestAllowedDts = 0;

  AudioSegmentStream.prototype.init.call(this);

  this.push = function(data) {
    collectDtsInfo(track, data);

    if (track && track.channelcount === undefined) {
      track.audioobjecttype = data.audioobjecttype;
      track.channelcount = data.channelcount;
      track.samplerate = data.samplerate;
      track.samplingfrequencyindex = data.samplingfrequencyindex;
      track.samplesize = data.samplesize;
    }

    // buffer audio data until end() is called
    aacFrames.push(data);
    aacFramesLength += data.data.byteLength;
  };

  this.setEarliestDts = function (earliestDts) {
    earliestAllowedDts = earliestDts;
  };

  this.flush = function() {
    var boxes, currentFrame, data, sample, i, mdat, moof;
    // return early if no audio data has been observed
    if (aacFramesLength === 0) {
      this.trigger('done');
      return;
    }

    // If the audio segment extends before the earliest allowed dts
    // value, remove AAC frames until starts at or after the earliest
    // allowed dts.
    if (track.minSegmentDts < earliestAllowedDts) {
      // We will need to recalculate the earliest segment Dts
      track.minSegmentDts = Infinity;

      aacFrames = aacFrames.filter(function(currentFrame) {
        // If this is an allowed frame, keep it and record it's Dts
        if (currentFrame.dts >= earliestAllowedDts) {
          track.minSegmentDts = Math.min(track.minSegmentDts, currentFrame.dts);
          return true;
        }
        // Otherwise, discard it
        aacFramesLength -= currentFrame.data.byteLength;
        return false;
      });
    }

    // concatenate the audio data to constuct the mdat
    data = new Uint8Array(aacFramesLength);
    track.samples = [];
    i = 0;
    while (aacFrames.length) {
      currentFrame = aacFrames[0];
      sample = {
        size: currentFrame.data.byteLength,
        duration: 1024 // FIXME calculate for realz
      };
      track.samples.push(sample);

      data.set(currentFrame.data, i);
      i += currentFrame.data.byteLength;

      aacFrames.shift();
    }
    aacFramesLength = 0;
    mdat = mp4.mdat(data);

    calculateTrackBaseMediaDecodeTime(track);
    moof = mp4.moof(sequenceNumber, [track]);
    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

    // bump the sequence number for next time
    sequenceNumber++;

    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    clearDtsInfo(track);
    this.trigger('data', {track: track, boxes: boxes});
    this.trigger('done');
  };
};
AudioSegmentStream.prototype = new muxjs.Stream();

/**
 * Accepts a NAL unit byte stream and unpacks the embedded NAL units.
 */
NalByteStream = function() {
  var
    syncPoint = 0,
    i,
    buffer;
  NalByteStream.prototype.init.call(this);

  this.push = function(data) {
    var swapBuffer;

    if (!buffer) {
      buffer = data.data;
    } else {
      swapBuffer = new Uint8Array(buffer.byteLength + data.data.byteLength);
      swapBuffer.set(buffer);
      swapBuffer.set(data.data, buffer.byteLength);
      buffer = swapBuffer;
    }

    // Rec. ITU-T H.264, Annex B
    // scan for NAL unit boundaries

    // a match looks like this:
    // 0 0 1 .. NAL .. 0 0 1
    // ^ sync point        ^ i
    // or this:
    // 0 0 1 .. NAL .. 0 0 0
    // ^ sync point        ^ i

    // advance the sync point to a NAL start, if necessary
    for (; syncPoint < buffer.byteLength - 3; syncPoint++) {
      if (buffer[syncPoint + 2] === 1) {
        // the sync point is properly aligned
        i = syncPoint + 5;
        break;
      }
    }

    while (i < buffer.byteLength) {
      // look at the current byte to determine if we've hit the end of
      // a NAL unit boundary
      switch (buffer[i]) {
      case 0:
        // skip past non-sync sequences
        if (buffer[i - 1] !== 0) {
          i += 2;
          break;
        } else if (buffer[i - 2] !== 0) {
          i++;
          break;
        }

        // deliver the NAL unit
        this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));

        // drop trailing zeroes
        do {
          i++;
        } while (buffer[i] !== 1 && i < buffer.length);
        syncPoint = i - 2;
        i += 3;
        break;
      case 1:
        // skip past non-sync sequences
        if (buffer[i - 1] !== 0 ||
            buffer[i - 2] !== 0) {
          i += 3;
          break;
        }

        // deliver the NAL unit
        this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
        syncPoint = i - 2;
        i += 3;
        break;
      default:
        // the current byte isn't a one or zero, so it cannot be part
        // of a sync sequence
        i += 3;
        break;
      }
    }
    // filter out the NAL units that were delivered
    buffer = buffer.subarray(syncPoint);
    i -= syncPoint;
    syncPoint = 0;
  };

  this.flush = function() {
    // deliver the last buffered NAL unit
    if (buffer && buffer.byteLength > 3) {
      this.trigger('data', buffer.subarray(syncPoint + 3));
    }
    // reset the stream state
    buffer = null;
    syncPoint = 0;
    this.trigger('done');
  };
};
NalByteStream.prototype = new muxjs.Stream();

/**
 * Accepts input from a ElementaryStream and produces H.264 NAL unit data
 * events.
 */
H264Stream = function() {
  var
    nalByteStream = new NalByteStream(),
    self,
    trackId,
    currentPts,
    currentDts,

    discardEmulationPreventionBytes,
    readSequenceParameterSet,
    skipScalingList;

  H264Stream.prototype.init.call(this);
  self = this;

  this.push = function(packet) {
    if (packet.type !== 'video') {
      return;
    }
    trackId = packet.trackId;
    currentPts = packet.pts;
    currentDts = packet.dts;

    nalByteStream.push(packet);
  };

  nalByteStream.on('data', function(data) {
    var
      event = {
        trackId: trackId,
        pts: currentPts,
        dts: currentDts,
        data: data
      };

    switch (data[0] & 0x1f) {
    case 0x05:
      event.nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
      break;
    case 0x06:
      event.nalUnitType = 'sei_rbsp';
      break;
    case 0x07:
      event.nalUnitType = 'seq_parameter_set_rbsp';
      event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
      event.config = readSequenceParameterSet(event.escapedRBSP);
      break;
    case 0x08:
      event.nalUnitType = 'pic_parameter_set_rbsp';
      break;
    case 0x09:
      event.nalUnitType = 'access_unit_delimiter_rbsp';
      break;

    default:
      break;
    }
    self.trigger('data', event);
  });
  nalByteStream.on('done', function() {
    self.trigger('done');
  });

  this.flush = function() {
    nalByteStream.flush();
  };

  /**
   * Advance the ExpGolomb decoder past a scaling list. The scaling
   * list is optionally transmitted as part of a sequence parameter
   * set and is not relevant to transmuxing.
   * @param count {number} the number of entries in this scaling list
   * @param expGolombDecoder {object} an ExpGolomb pointed to the
   * start of a scaling list
   * @see Recommendation ITU-T H.264, Section 7.3.2.1.1.1
   */
  skipScalingList = function(count, expGolombDecoder) {
    var
      lastScale = 8,
      nextScale = 8,
      j,
      deltaScale;

    for (j = 0; j < count; j++) {
      if (nextScale !== 0) {
        deltaScale = expGolombDecoder.readExpGolomb();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }

      lastScale = (nextScale === 0) ? lastScale : nextScale;
    }
  };

  /**
   * Expunge any "Emulation Prevention" bytes from a "Raw Byte
   * Sequence Payload"
   * @param data {Uint8Array} the bytes of a RBSP from a NAL
   * unit
   * @return {Uint8Array} the RBSP without any Emulation
   * Prevention Bytes
   */
  discardEmulationPreventionBytes = function(data) {
    var
      length = data.byteLength,
      emulationPreventionBytesPositions = [],
      i = 1,
      newLength, newData;

    // Find all `Emulation Prevention Bytes`
    while (i < length - 2) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
        emulationPreventionBytesPositions.push(i + 2);
        i += 2;
      } else {
        i++;
      }
    }

    // If no Emulation Prevention Bytes were found just return the original
    // array
    if (emulationPreventionBytesPositions.length === 0) {
      return data;
    }

    // Create a new array to hold the NAL unit data
    newLength = length - emulationPreventionBytesPositions.length;
    newData = new Uint8Array(newLength);
    var sourceIndex = 0;

    for (i = 0; i < newLength; sourceIndex++, i++) {
      if (sourceIndex === emulationPreventionBytesPositions[0]) {
        // Skip this byte
        sourceIndex++;
        // Remove this position index
        emulationPreventionBytesPositions.shift();
      }
      newData[i] = data[sourceIndex];
    }

    return newData;
  };

  /**
   * Read a sequence parameter set and return some interesting video
   * properties. A sequence parameter set is the H264 metadata that
   * describes the properties of upcoming video frames.
   * @param data {Uint8Array} the bytes of a sequence parameter set
   * @return {object} an object with configuration parsed from the
   * sequence parameter set, including the dimensions of the
   * associated video frames.
   */
  readSequenceParameterSet = function(data) {
    var
      frameCropLeftOffset = 0,
      frameCropRightOffset = 0,
      frameCropTopOffset = 0,
      frameCropBottomOffset = 0,
      expGolombDecoder, profileIdc, levelIdc, profileCompatibility,
      chromaFormatIdc, picOrderCntType,
      numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1,
      picHeightInMapUnitsMinus1,
      frameMbsOnlyFlag,
      scalingListCount,
      i;

    expGolombDecoder = new muxjs.ExpGolomb(data);
    profileIdc = expGolombDecoder.readUnsignedByte(); // profile_idc
    profileCompatibility = expGolombDecoder.readUnsignedByte(); // constraint_set[0-5]_flag
    levelIdc = expGolombDecoder.readUnsignedByte(); // level_idc u(8)
    expGolombDecoder.skipUnsignedExpGolomb(); // seq_parameter_set_id

    // some profiles have more optional data we don't need
    if (profileIdc === 100 ||
        profileIdc === 110 ||
        profileIdc === 122 ||
        profileIdc === 244 ||
        profileIdc ===  44 ||
        profileIdc ===  83 ||
        profileIdc ===  86 ||
        profileIdc === 118 ||
        profileIdc === 128 ||
        profileIdc === 138 ||
        profileIdc === 139 ||
        profileIdc === 134) {
      chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
      if (chromaFormatIdc === 3) {
        expGolombDecoder.skipBits(1); // separate_colour_plane_flag
      }
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_luma_minus8
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8
      expGolombDecoder.skipBits(1); // qpprime_y_zero_transform_bypass_flag
      if (expGolombDecoder.readBoolean()) { // seq_scaling_matrix_present_flag
        scalingListCount = (chromaFormatIdc !== 3) ? 8 : 12;
        for (i = 0; i < scalingListCount; i++) {
          if (expGolombDecoder.readBoolean()) { // seq_scaling_list_present_flag[ i ]
            if (i < 6) {
              skipScalingList(16, expGolombDecoder);
            } else {
              skipScalingList(64, expGolombDecoder);
            }
          }
        }
      }
    }

    expGolombDecoder.skipUnsignedExpGolomb(); // log2_max_frame_num_minus4
    picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();

    if (picOrderCntType === 0) {
      expGolombDecoder.readUnsignedExpGolomb(); //log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      expGolombDecoder.skipBits(1); // delta_pic_order_always_zero_flag
      expGolombDecoder.skipExpGolomb(); // offset_for_non_ref_pic
      expGolombDecoder.skipExpGolomb(); // offset_for_top_to_bottom_field
      numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
      for(i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        expGolombDecoder.skipExpGolomb(); // offset_for_ref_frame[ i ]
      }
    }

    expGolombDecoder.skipUnsignedExpGolomb(); // max_num_ref_frames
    expGolombDecoder.skipBits(1); // gaps_in_frame_num_value_allowed_flag

    picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
    picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();

    frameMbsOnlyFlag = expGolombDecoder.readBits(1);
    if (frameMbsOnlyFlag === 0) {
      expGolombDecoder.skipBits(1); // mb_adaptive_frame_field_flag
    }

    expGolombDecoder.skipBits(1); // direct_8x8_inference_flag
    if (expGolombDecoder.readBoolean()) { // frame_cropping_flag
      frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
    }

    return {
      profileIdc: profileIdc,
      levelIdc: levelIdc,
      profileCompatibility: profileCompatibility,
      width: ((picWidthInMbsMinus1 + 1) * 16) - frameCropLeftOffset * 2 - frameCropRightOffset * 2,
      height: ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) - (frameCropTopOffset * 2) - (frameCropBottomOffset * 2)
    };
  };

};
H264Stream.prototype = new muxjs.Stream();

/**
 * Constructs a single-track, ISO BMFF media segment from H264 data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 * @param track {object} track metadata configuration
 */
VideoSegmentStream = function(track) {
  var
    sequenceNumber = 0,
    nalUnits = [],
    nalUnitsLength = 0,
    config,
    pps;
  VideoSegmentStream.prototype.init.call(this);

  delete track.minPTS;

  this.push = function(data) {
    collectDtsInfo(track, data);

    // record the track config
    if (data.nalUnitType === 'seq_parameter_set_rbsp' &&
        !config) {
      config = data.config;

      track.width = config.width;
      track.height = config.height;
      track.sps = [data.data];
      track.profileIdc = config.profileIdc;
      track.levelIdc = config.levelIdc;
      track.profileCompatibility = config.profileCompatibility;
    }

    if (data.nalUnitType === 'pic_parameter_set_rbsp' &&
        !pps) {
      pps = data.data;
      track.pps = [data.data];
    }

    // buffer video until end() is called
    nalUnits.push(data);
    nalUnitsLength += data.data.byteLength;
  };

  this.flush = function() {
    var startUnit, currentNal, moof, mdat, boxes, i, data, view, sample;

    // return early if no video data has been observed
    if (nalUnitsLength === 0) {
      return;
    }

    // concatenate the video data and construct the mdat
    // first, we have to build the index from byte locations to
    // samples (that is, frames) in the video data
    data = new Uint8Array(nalUnitsLength + (4 * nalUnits.length));
    view = new DataView(data.buffer);
    track.samples = [];

    // see ISO/IEC 14496-12:2012, section 8.6.4.3
    sample = {
      size: 0,
      flags: {
        isLeading: 0,
        dependsOn: 1,
        isDependedOn: 0,
        hasRedundancy: 0,
        degradationPriority: 0
      }
    };
    i = 0;
    while (nalUnits.length) {
      currentNal = nalUnits[0];
      // flush the sample we've been building when a new sample is started
      if (currentNal.nalUnitType === 'access_unit_delimiter_rbsp') {
        if (startUnit) {
          sample.duration = currentNal.dts - startUnit.dts;
          track.samples.push(sample);
        }
        sample = {
          size: 0,
          flags: {
            isLeading: 0,
            dependsOn: 1,
            isDependedOn: 0,
            hasRedundancy: 0,
            degradationPriority: 0
          },
          compositionTimeOffset: currentNal.pts - currentNal.dts
        };
        startUnit = currentNal;
      }
      if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
        // the current sample is a key frame
        sample.flags.dependsOn = 2;
      }
      sample.size += 4; // space for the NAL length
      sample.size += currentNal.data.byteLength;

      view.setUint32(i, currentNal.data.byteLength);
      i += 4;
      data.set(currentNal.data, i);
      i += currentNal.data.byteLength;

      nalUnits.shift();
    }
    // record the last sample
    if (track.samples.length) {
      sample.duration = track.samples[track.samples.length - 1].duration;
    }
    track.samples.push(sample);
    nalUnitsLength = 0;
    mdat = mp4.mdat(data);

    calculateTrackBaseMediaDecodeTime(track);

    this.trigger('timelineStartInfo', track.timelineStartInfo);

    moof = mp4.moof(sequenceNumber, [track]);

    // it would be great to allocate this array up front instead of
    // throwing away hundreds of media segment fragments
    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

    // bump the sequence number for next time
    sequenceNumber++;

    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    clearDtsInfo(track);
    this.trigger('data', {track: track, boxes: boxes});

    // reset config and pps because they may differ across segments
    // for instance, when we are rendition switching
    config = undefined;
    pps = undefined;

    // Continue with the flush process now
    this.trigger('done');
  };
};
VideoSegmentStream.prototype = new muxjs.Stream();

/**
 * Store information about the start and end of the tracka and the
 * duration for each frame/sample we process in order to calculate
 * the baseMediaDecodeTime
 */
collectDtsInfo = function (track, data) {
  if (typeof data.pts === 'number') {
    if (track.timelineStartInfo.pts === undefined) {
      track.timelineStartInfo.pts = data.pts;
    } else {
      track.timelineStartInfo.pts =
        Math.min(track.timelineStartInfo.pts, data.pts);
    }
  }

  if (typeof data.dts === 'number') {
    if (track.timelineStartInfo.dts === undefined) {
      track.timelineStartInfo.dts = data.dts;
    } else {
      track.timelineStartInfo.dts =
        Math.min(track.timelineStartInfo.dts, data.dts);
    }

    if (track.minSegmentDts === undefined) {
      track.minSegmentDts = data.dts;
    } else {
      track.minSegmentDts = Math.min(track.minSegmentDts, data.dts);
    }

    if (track.maxSegmentDts === undefined) {
      track.maxSegmentDts = data.dts;
    } else {
      track.maxSegmentDts = Math.max(track.maxSegmentDts, data.dts);
    }
  }
};

/**
 * Clear values used to calculate the baseMediaDecodeTime between
 * tracks
 */
clearDtsInfo = function (track) {
  delete track.minSegmentDts;
  delete track.maxSegmentDts;
};

/**
 * Calculate the track's baseMediaDecodeTime based on the earliest
 * DTS the transmuxer has ever seen and the minimum DTS for the
 * current track
 */
calculateTrackBaseMediaDecodeTime = function (track) {
  var
    oneSecondInPTS = 90000, // 90kHz clock
    scale;

  track.baseMediaDecodeTime = track.minSegmentDts - track.timelineStartInfo.dts;

  if (track.type === 'audio') {
    // Audio has a different clock equal to the sampling_rate so we need to
    // scale the PTS values into the clock rate of the track
    scale = track.samplerate / oneSecondInPTS;
    track.baseMediaDecodeTime *= scale;
    track.baseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime);
  }
};

/**
 * A Stream that can combine multiple streams (ie. audio & video)
 * into a single output segment for MSE. Also supports audio-only
 * and video-only streams.
 */
CoalesceStream = function(options) {
  // Number of Tracks per output segment
  // If greater than 1, we combine multiple
  // tracks into a single segment
  this.numberOfTracks = 0;
  this.metadataStream = options.metadataStream;

  if (typeof options.remux !== 'undefined') {
    this.remuxTracks = !!options.remux;
  } else {
    this.remuxTracks = true;
  }

  this.pendingTracks = [];
  this.videoTrack = null;
  this.pendingBoxes = [];
  this.pendingCaptions = [];
  this.pendingMetadata = [];
  this.pendingBytes = 0;

  CoalesceStream.prototype.init.call(this);

  // Take output from multiple
  this.push = function(output) {
    // buffer incoming captions until the associated video segment
    // finishes
    if (output.text) {
      return this.pendingCaptions.push(output);
    }
    // buffer incoming id3 tags until the final flush
    if (output.frames) {
      return this.pendingMetadata.push(output);
    }

    // Add this track to the list of pending tracks and store
    // important information required for the construction of
    // the final segment
    this.pendingTracks.push(output.track);
    this.pendingBoxes.push(output.boxes);
    this.pendingBytes += output.boxes.byteLength;

    if (output.track.type === 'video') {
      this.videoTrack = output.track;
    }
    if (output.track.type === 'audio') {
      this.audioTrack = output.track;
    }
  };
};

CoalesceStream.prototype = new muxjs.Stream();
CoalesceStream.prototype.flush = function() {
  var
    offset = 0,
    event = {
      captions: [],
      metadata: []
    },
    caption,
    id3,
    initSegment,
    timelineStartPts = 0,
    i;

  // Return until we have enough tracks from the pipeline to remux
  if (this.pendingTracks.length === 0 ||
     (this.remuxTracks && this.pendingTracks.length < this.numberOfTracks)) {
    return;
  }

  if (this.videoTrack) {
    timelineStartPts = this.videoTrack.timelineStartInfo.pts;
  } else if (this.audioTrack) {
    timelineStartPts = this.audioTrack.timelineStartInfo.pts;
  }

  if (this.pendingTracks.length === 1) {
    event.type = this.pendingTracks[0].type;
  } else {
    event.type = 'combined';
  }

  initSegment = muxjs.mp4.initSegment(this.pendingTracks, this.options);
  this.pendingBytes += initSegment.byteLength;
  this.pendingBoxes.unshift(initSegment);

  // Create a new typed array large enough to hold the init
  // segment and all tracks
  event.data = new Uint8Array(this.pendingBytes);

  // Process each moof+mdat (one per track)
  for (i = 0; i < this.pendingBoxes.length; i++) {
    event.data.set(this.pendingBoxes[i], offset);
    offset += this.pendingBoxes[i].byteLength;
  }

  // Translate caption PTS times into second offsets into the
  // video timeline for the segment
  for (i = 0; i < this.pendingCaptions.length; i++) {
    caption = this.pendingCaptions[i];
    caption.startTime = caption.startPts - timelineStartPts;
    caption.startTime /= 90e3;
    caption.endTime = caption.endPts - timelineStartPts;
    caption.endTime /= 90e3;
    event.captions.push(caption);
  }

  // Translate ID3 frame PTS times into second offsets into the
  // video timeline for the segment
  for (i = 0; i < this.pendingMetadata.length; i++) {
    id3 = this.pendingMetadata[i];
    id3.cueTime = id3.pts - timelineStartPts;
    id3.cueTime /= 90e3;
    event.metadata.push(id3);
  }
  // We add this to every single emitted segment even though we only need
  // it for the first
  event.metadata.dispatchType = this.metadataStream.dispatchType;

  // Reset stream state
  this.pendingTracks.length = 0;
  this.videoTrack = null;
  this.pendingBoxes.length = 0;
  this.pendingCaptions.length = 0;
  this.pendingBytes = 0;
  this.pendingMetadata.length = 0;

  // Emit the final segment
  this.trigger('data', event);
  this.trigger('done');
};

/**
 * A Stream that expects MP2T/MP4 binary data as input and produces
 * corresponding media segments, suitable for use with Media Source
 * Extension (MSE) implementations that support the ISO BMFF byte
 * stream format, like Chrome.
 */
Transmuxer = function(options) {
  var
    self = this,
    videoTrack,
    audioTrack,

    packetStream, parseStream, elementaryStream, mp4BuilderStream,
    aacStream, h264Stream, videoSegmentStream, audioSegmentStream,
    captionStream, coalesceStream;

  Transmuxer.prototype.init.call(this);
  options = options || {};
  options.input_type = options.input_type||'m2ts';
  elementaryStream = options.input_type=='m2ts' ?
    new ElementaryStream() : new muxjs.MP4ParserStream(options);

  // set up the parsing pipeline
  if (options.input_type=='m2ts')
  {
    // expose the metadata stream
    this.metadataStream = new muxjs.mp2t.MetadataStream();
    options.metadataStream = this.metadataStream;
    coalesceStream = new CoalesceStream(options);

    packetStream = new TransportPacketStream();
    parseStream = new TransportParseStream();
    aacStream = new AacStream();
    h264Stream = new H264Stream();

    // disassemble MPEG2-TS packets into elementary streams
    packetStream
      .pipe(parseStream)
      .pipe(elementaryStream);

    // !!THIS ORDER IS IMPORTANT!!
    // demux the streams
    elementaryStream
      .pipe(h264Stream);
    elementaryStream
      .pipe(aacStream);

    elementaryStream
      .pipe(this.metadataStream)
      .pipe(coalesceStream);
    // if CEA-708 parsing is available, hook up a caption stream
    if (muxjs.mp2t.CaptionStream) {
      captionStream = new muxjs.mp2t.CaptionStream();
      h264Stream.pipe(captionStream)
        .pipe(coalesceStream);
    }
  }
  else
  {
    mp4BuilderStream = new muxjs.MP4BuilderStream(options);
    elementaryStream
      .pipe(mp4BuilderStream);
    this.seek = function(pos, ss){ return elementaryStream.seek(pos, ss); };
    this.get_tl = function(id){ return elementaryStream.get_tl(id); };
    this.appendBuffer = function(buf){
        return elementaryStream.push(new Uint8Array(buf)); };
  }
  // hook up the segment streams once track metadata is delivered
  elementaryStream.on('data', function(data) {
    var i, videoTrack, audioTrack;
    if (data.type === 'metadata') {
      if (options.input_type!='m2ts')
        return void self.trigger('metadata', data);
      i = data.tracks.length;

      // scan the tracks listed in the metadata
      while (i--) {
        if (data.tracks[i].type === 'video') {
          videoTrack = data.tracks[i];
        } else if (data.tracks[i].type === 'audio') {
          audioTrack = data.tracks[i];
        }
      }

      // hook up the video segment stream to the first track with h264 data
      if (videoTrack && !videoSegmentStream) {
        coalesceStream.numberOfTracks++;
        videoSegmentStream = new VideoSegmentStream(videoTrack);

        videoSegmentStream.on('timelineStartInfo', function(timelineStartInfo){
          // When video emits timelineStartInfo data after a flush, we forward that
          // info to the AudioSegmentStream, if it exists, because video timeline
          // data takes precedence.
          if (audioTrack) {
            audioTrack.timelineStartInfo = timelineStartInfo;

            // On the first segment we trim AAC frames that exist before the
            // very earliest DTS we have seen in video because Chrome will
            // interpret any video track with a baseMediaDecodeTime that is
            // non-zero as a gap.
            audioSegmentStream.setEarliestDts(timelineStartInfo.dts);
          }
        });

        // Set up the final part of the video pipeline
        h264Stream
          .pipe(videoSegmentStream)
          .pipe(coalesceStream);
      }

      if (audioTrack && !audioSegmentStream) {
        // hook up the audio segment stream to the first track with aac data
        coalesceStream.numberOfTracks++;
        audioSegmentStream = new AudioSegmentStream(audioTrack);

        // Set up the final part of the audio pipeline
        aacStream
          .pipe(audioSegmentStream)
          .pipe(coalesceStream);
      }
    }
  });

  // feed incoming data to the front of the parsing pipeline
  this.push = function(data) {
    if (options.input_type!='m2ts')
      return elementaryStream.push(data);
    packetStream.push(data);
  };

  // flush any buffered data
  this.flush = function() {
    // Start at the top of the pipeline and flush all pending work
    if (options.input_type!='m2ts')
      return void elementaryStream.flush();
    packetStream.flush();
  };

  if (options.input_type!='m2ts')
  {
    mp4BuilderStream.on('data', function (data) {
      self.trigger('data', data);
    });
    mp4BuilderStream.on('done', function (data) {
      self.trigger('done', data);
    });
  }
  else
  {
    // Re-emit any data coming from the coalesce stream to the outside world
    coalesceStream.on('data', function (data) {
      self.trigger('data', data);
    });
    // Let the consumer know we have finished flushing the entire pipeline
    coalesceStream.on('done', function () {
      self.trigger('done');
    });
  }
};
Transmuxer.prototype = new muxjs.Stream();

// exports
muxjs.mp2t = muxjs.mp2t || {};
muxjs.mp2t.PAT_PID = 0x0000;
muxjs.mp2t.MP2T_PACKET_LENGTH = MP2T_PACKET_LENGTH;

muxjs.mp2t.H264_STREAM_TYPE = H264_STREAM_TYPE;
muxjs.mp2t.ADTS_STREAM_TYPE = ADTS_STREAM_TYPE;
muxjs.mp2t.METADATA_STREAM_TYPE = METADATA_STREAM_TYPE;

muxjs.mp2t.TransportPacketStream = TransportPacketStream;
muxjs.mp2t.TransportParseStream = TransportParseStream;
muxjs.mp2t.ElementaryStream = ElementaryStream;
muxjs.mp2t.VideoSegmentStream = VideoSegmentStream;
muxjs.mp2t.Transmuxer = Transmuxer;
muxjs.mp2t.AacStream = AacStream;
muxjs.mp2t.H264Stream = H264Stream;
muxjs.mp2t.NalByteStream = NalByteStream;

})(this, this.muxjs);
