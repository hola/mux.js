'use strict';

var Stream = require('../utils/stream.js');
var mp4 = require('./mp4-generator.js');
var sample_type={vide: 'video', soun: 'audio'};
var full_box = ['meta', 'mvhd', 'tkhd', 'mdhd', 'smhd', 'vmhd', 'dref',
    'hdlr', 'stsd', 'esds', 'stts', 'stps', 'stss', 'ctts', 'stsc', 'stsz',
    'stco', 'esds', 'elst', 'nmhd', 'cslg', 'sdtp', 'co64'];
// tgas, elng - non-standard unknown boxes seen in some videos
var raw_copy = ['udta', 'smhd', 'vmhd', 'dref', 'iods', 'btrt', 'pasp', 'clap',
    'uuid', 'colr', 'sbgp', 'sgpd', 'gmhd', 'tref', 'nmhd', 'svcC', 'hmhd',
    'fiel', 'tapt', 'load', 'meta', 'sefd', 'beam', 'tgas', 'elng'];
var containers = {
    trak: {name: 'track_info', multi: 1},
    edts: {name: 'edit_list'},
    exts: {name: 'edit_list'},
    mdia: {name: 'media_box'},
    minf: {name: 'media_info'},
    dinf: {name: 'data_info'},
    stbl: {name: 'sample_table'},
};
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
function Bit_reader(view, ptr, size){
    var pos = 0, len = size*8;
    this.read = function(count, peek){
        var ret = 0, p = pos>>3, r = 7-pos%8;
        for (var i = 0, c = view.getUint8(p+ptr); i<count; i++, r--)
        {
            ret = (ret<<1)|((c>>r)&1);
            if (r)
                continue;
            p++;
            r = 8;
            c = view.getUint8(p+ptr);
        }
        if (!peek)
            pos += count;
        return ret;
    };
    this.bits = function(){ return len-pos; };
}
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
        return (opt.offset = 0);
    opt.size = opt.view.getUint32(opt.ptr);
    if (opt.size==1)
    {
        opt.offset = 16;
        if (opt.buffer.b_size-opt.ptr<16)
            return (opt.offset = 0);
        opt.size = (opt.view.getUint32(opt.ptr+8)<<32)+
            opt.view.getUint32(opt.ptr+12);
    }
    opt.type = int_to_str(opt.view.getUint32(opt.ptr+4));
    if (full_box.includes(opt.type))
    {
        opt.offset += 4;
        if (opt.buffer.b_size-opt.ptr<opt.offset)
            return (opt.offset = 0);
        var extra = opt.view.getUint8(opt.ptr+opt.offset-4);
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
Box_parser.prototype.ftyp = function(opt){
    opt.branch.major_brand = int_to_str(opt.view.getUint32(opt.ptr));
    opt.branch.minor_version = opt.view.getUint32(opt.ptr+4);
    opt.branch.compatible = [opt.branch.major_brand];
    for (var i=8; i<opt.size; i+=4)
        opt.branch.compatible.push(int_to_str(opt.view.getUint32(opt.ptr+i)));
};
Box_parser.prototype.mdat = function(){};
Box_parser.prototype.free = function(){};
Box_parser.prototype.wide = function(){};
Box_parser.prototype.skip = function(){};
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
    var count = view.getUint32(opt.ptr);
    opt.branch.list = [];
    for (var i=0; i<count; ptr += 4, i++)
    {
        var elm = {};
        elm.segment_duration = opt.ver ?
            getUint64(view, ptr) : view.getUint32(ptr);
        elm.media_time = opt.ver ?
            getInt64(view, ptr+8) : view.getInt32(ptr+4);
        ptr += opt.ver ? 16 : 8;
        elm.media_rate = view.getInt16(ptr);
        opt.branch.list.push(elm);
    }
};
Box_parser.prototype.cslg = function(opt){
    var view = opt.view, ptr = opt.ptr;
    opt.branch.cslg = {
        ctts_shift: view.getInt32(ptr),
        min_ctts: view.getInt32(ptr+4),
        max_ctts: view.getInt32(ptr+8),
        min_cts: view.getInt32(ptr+12),
        max_cts: view.getInt32(ptr+16),
    };
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
            var ext_type, br = new Bit_reader(view, ptr, sz);
            elm.aot = br.read(5);
            if (elm.aot==31)
                elm.aot = 32+br.read(6);
            elm.freq = br.read(4);
            if (elm.freq==15)
                elm.freq = br.read(24);
            elm.channel = br.read(4);
            // Read ext configuration for explicitly signaled HE-AAC profiles
            // 5 = HEv1, 29 = HEv2
            if (elm.aot==5 || elm.aot==29)
            {
                ext_type = 5;
                if ((elm.ext_freq_index = br.read(4))==0xf)
                    elm.ext_freq = br.read(24);
                // With HE extensions now known, determine underlying profile.
                elm.aot = br.read(5);
                if (elm.aot==31)
                    elm.aot = 32+br.read(6);
            }
            if (ext_type!=5 && elm.aot!=36)
            {
                while (br.bits()>=16)
                {
                    if (br.read(11, 1)==0x2b7) // sync_ext_type
                    {
                        br.read(11);
                        if (br.read(5)==5) // type_ext
                        {
                            if (br.read(1)) // sbr
                            {
                                if (br.read(4)==0xf) // sr_ext
                                    br.read(24);
                                if (br.bits()>=12 && br.read(11)==0x548 &&
                                    br.read(1)!=1)
                                {
                                    elm.dsi = 5;
                                }
                            }
                        }
                    }
                    else
                        br.read(1);
                }
            }
            ptr += sz;
            break;
        default:
            ptr += sz;
        }
    }
};
Box_parser.prototype.stsd = function(opt){
    var view = opt.view, count = view.getUint32(opt.ptr);
    var handler = opt.branch.parent.parent.handler, i, j;
    opt.branch.list = {};
    opt.ptr += 4;
    for (i=0; i<count; i++)
    {
        this.header(opt);
        var elm = {};
        var index = view.getUint16(opt.ptr+6);
        var last_ptr = opt.ptr+opt.size;
        switch (handler)
        {
        case 'vide':
            elm.width = view.getUint16(opt.ptr+24);
            elm.height = view.getUint16(opt.ptr+26);
            elm.h_res = view.getUint32(opt.ptr+28)/65536.0;
            elm.v_res = view.getUint32(opt.ptr+32)/65536.0;
            elm.f_count = view.getUint16(opt.ptr+40);
            elm.compressor = '';
            for (j=0; j<32; j++)
            {
                var c = view.getUint8(opt.ptr+42+j);
                if (!c)
                    break;
                elm.compressor += String.fromCharCode();
            }
            elm.depth = view.getUint16(opt.ptr+74);
            // 'colr', 'clap', 'pasp' & 'fiel'
            var skip_boxes = [0x636F6C72, 0x636C6170, 0x70617370, 0x6669656C];
            while (skip_boxes.includes(view.getUint32(opt.ptr+82)))
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
            for (j=32; j<opt.size-12; j++)
            {
                if (view.getUint32(opt.ptr+j)==0x65736473) // esds
                {
                    elm.esds = {};
                    opt.ptr += j-4;
                    this.header(opt);
                    this._parse_esds(opt, elm.esds);
                    break;
                }
            }
            break;
        default:
        }
        opt.ptr = last_ptr;
        opt.branch.list[index] = elm;
    }
    opt.size = 0;
};
Box_parser.prototype.stts = function(opt){
    var cnt = opt.view.getUint32(opt.ptr), ptr = opt.ptr+4;
    opt.branch.dtts = [];
    for (var i=0; i<cnt; i++)
    {
        var u_cnt = opt.view.getUint32(opt.ptr+4+i*8);
        var data = opt.view.getUint32(ptr+i*8+4);
        for (var j=0; j<u_cnt; j++)
             opt.branch.dtts.push(data);
    }
};
Box_parser.prototype.ctts = function(opt){
    var cnt = opt.view.getUint32(opt.ptr), ptr = opt.ptr+4;
    opt.branch.ctts = [];
    for (var i=0; i<cnt; i++)
    {
        var u_cnt = opt.view.getUint32(ptr+i*8);
        var data = opt.view.getInt32(ptr+i*8+4);
        for (var j=0; j<u_cnt; j++)
            opt.branch.ctts.push(data);
    }
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
Box_parser.prototype.stps = function(opt){
    get_table(opt.view, opt.ptr+4, opt.view.getUint32(opt.ptr),
        opt.branch.s_psync = []);
};
Box_parser.prototype.sdtp = function(opt){
    opt.branch.s_dep = [];
    for (var i=0; i<opt.size; i++)
    {
        var bt = opt.view.getUint8(opt.ptr+i);
        opt.branch.s_dep[i] = {
            red: bt&3,
            is_dep: bt>>2&3,
            dep: bt>>4&3,
            lead: bt>>6&3,
        };
    }
};
Box_parser.prototype.stsz = function(opt){
    var size = opt.view.getUint32(opt.ptr);
    opt.branch.s_sz = [];
    opt.branch.s_count = opt.view.getUint32(opt.ptr+4);
    if (!size)
        get_table(opt.view, opt.ptr+8, opt.branch.s_count, opt.branch.s_sz);
    else
    {
        for (var i=0; i<opt.branch.s_count; i++)
            opt.branch.s_sz.push(size);
    }
};
Box_parser.prototype.stco = function(opt){
    get_table(opt.view, opt.ptr+4, opt.view.getUint32(opt.ptr),
        opt.branch.c_off = []);
};
Box_parser.prototype.co64 = function(opt){
    var cnt = opt.view.getUint32(opt.ptr);
    opt.branch.c_off = [];
    for (var i=0; i<cnt; i++)
        opt.branch.c_off[i] = getUint64(opt.view, opt.ptr+4+i*8);
};

var Chunk_parser = function(opt){
    this.conf_update(opt);
};
Chunk_parser.prototype = {};
Chunk_parser.prototype.conf_update = function(conf){
    this.break_on_count = conf.break_on_count;
    this.frag_size = conf.frag_size||10;
    this.val_frame_nal_len4 = conf.val_frame_nal_len4;
};
Chunk_parser.prototype.process = function(opt){
    var event = {
        type: 'metadata',
        tracks: [],
        brands: ['iso5', 'iso6'],
        matrix: opt.root.movie_box.mv_hdr.matrix,
        start_hdr_sz: opt.root.start_hdr_sz,
        end_hdr_sz: opt.root.end_hdr_sz,
    };
    var _this = this;
    event.duration = Math.floor(opt.root.movie_box.mv_hdr.duration*90000/
        opt.root.movie_box.mv_hdr.time_scale);
    event.timescale = 90000;
    event.s_info = this.s_info = [];
    event.s_p = this.s_p = [];
    opt.root.movie_box.track_info.forEach(function(tr){
        if (!['vide', 'soun'].includes(tr.media_box.handler) ||
            !tr.media_box.media_info.sample_table.list[1].esds &&
            tr.media_box.handler=='soun')
        {
            return;
        }
        var elm = {
            id: tr.tk_hdr.track_id,
            ts: tr.media_box.md_hdr.time_scale,
            type: tr.media_box.handler,
            s_off: [],
            s_time: [],
            s_dri: [],
            s_sync: tr.media_box.media_info.sample_table.s_sync||[],
            s_psync: tr.media_box.media_info.sample_table.s_psync||[],
            s_sz: tr.media_box.media_info.sample_table.s_sz,
            s_dep: tr.media_box.media_info.sample_table.s_dep||[],
            s_ctts: tr.media_box.media_info.sample_table.ctts||[],
            s_cslg: tr.media_box.media_info.sample_table.cslg||{},
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
        var is_sz_arr = Array.isArray(elm.s_sz);
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
                    off += is_sz_arr ? elm.s_sz[sn++] : elm.s_sz;
                }
            }
        }
        _this.s_info.push(elm);
        _this.s_p.push({s: 0, max_t: 0});
        if (elm.type=='vide')
            event.v_idx = _this.v_idx = _this.s_info.length-1;
        var dr = elm.s_list[1];
        var event_elm = {
            id: elm.id,
            type: sample_type[elm.type],
            edit_list: elm.elst,
            cslg: elm.s_cslg,
            dr: dr,
            timelineStartInfo: {baseMediaDecodeTime: 0},
            bitrate: Math.floor(elm.s_sz.reduce(function(a, b){ return a+b; })*
                8*elm.ts/tr.media_box.md_hdr.duration),
            duration: elm.type=='soun' ?
                tr.media_box.md_hdr.duration :
                Math.floor(tr.media_box.md_hdr.duration*90000/elm.ts),
            samplerate: elm.type=='soun' ? elm.ts : 90000,
            matrix: tr.tk_hdr.matrix,
            track_width: tr.tk_hdr.width,
            track_height: tr.tk_hdr.height,
            nb_samples: elm.s_time.length,
        };
        if (elm.type=='soun')
        {
            var aot = dr.esds.dsi||dr.esds.aot;
            event_elm.codec = 'mp4a.'+byte_to_hex(dr.esds.obj_t.toString(16))+
                (aot ? '.'+aot : '');
            event_elm.s_i = new Uint8Array([dr.esds.aot<<3|dr.esds.freq>>>1,
                dr.esds.freq<<7|dr.esds.channel<<3]);
        }
        else
        {
            event_elm.codec = 'avc1.'+byte_to_hex(dr.avcc.avc_p_i)+
                byte_to_hex(dr.avcc.prof_compat)+byte_to_hex(dr.avcc.avc_l_i);
            var info = [1, dr.avcc.avc_p_i, dr.avcc.avc_prof_compat,
                dr.avcc.avc_l_i, 255, dr.avcc.sps.length+224];
            dr.avcc.sps.forEach(function(e){
                info = info.concat([e.nal.length>>8, e.nal.length&255]);
                Array.prototype.push.apply(info, e.nal);
            });
            info.push(dr.avcc.pps.length);
            dr.avcc.pps.forEach(function(e){
                info = info.concat([e.nal.length>>8, e.nal.length&255]);
                Array.prototype.push.apply(info, e.nal);
            });
            event_elm.s_i = new Uint8Array(info);
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
        if (event_elm.cslg)
        {
            for (var k in event_elm.cslg)
                event_elm.cslg[k] = Math.floor(event_elm.cslg[k]*90000/elm.ts);
        }
        event.tracks.push(event_elm);
    });
    opt.stream.trigger('data', event);
};
Chunk_parser.prototype.is_annexb_avc_len_size4 = function(data){
    var len_size = 4, pos = 0;
    while (pos+len_size<data.byteLength)
    {
        var nal_size = data[pos];
        nal_size = (nal_size<<8)+data[pos+1];
        nal_size = (nal_size<<8)+data[pos+2];
        nal_size = (nal_size<<8)+data[pos+3];
        pos += len_size+nal_size;
    }
    return pos==data.byteLength;

};
Chunk_parser.prototype.parse = function(opt){
    if (!this.s_info)
        this.process(opt);
    var b_start = opt.buffer.b_pos;
    var b_end = opt.buffer.b_size+b_start;
    var pc = -1, max_dcd = 0, i;
    var v_fin = false;
    while (pc)
    {
        pc = 0;
        for (i=0; i<this.s_p.length; i++)
        {
            var sinfo = this.s_info[i];
            var sn = this.s_p[i].s;
            var pos = sinfo.s_off[sn];
            var sz = sinfo.s_sz[sn];
            var time = sinfo.s_time;
            var valid = true;
            if (pos>=b_start && pos+sz<=b_end)
            {
                this.s_p[i].s++;
                pc++;
                var sample = {trackId: sinfo.id};
                sample.type = sample_type[sinfo.type];
                sample.dts = time[sn];
                sample.pts = sample.dts+(sinfo.s_ctts[sn]||0);
                sample.duration = sn==time.length-1 ?
                    time[sn]-time[sn-1] : time[sn+1]-time[sn];
                sample.size = sz;
                this.s_p[i].max_t = sample.dts/sinfo.ts;
                sample.data = opt.buffer._buff.subarray(pos-b_start,
                    pos+sz-b_start);
                sample.dr = sinfo.s_list[sinfo.s_dri[sn]];
                sample.ts = sinfo.ts;
                sample.synced =  !sinfo.s_sync.length ||
                    sinfo.s_sync.includes(sn+1);
                sample.sn = sn;
                sample.dep = sinfo.s_dep[sn];
                if (sinfo.type=='vide' && (this.break_on_count ?
                    sn%this.frag_size===0 : sn&&sample.synced))
                {
                    opt.stream.flush();
                }
                var avcc = sample.dr&&sample.dr.avcc;
                if (this.val_frame_nal_len4 && avcc && avcc.l_size_m_1==3 &&
                    sample.type=='video' && sample.duration==1)
                {
                    valid = this.is_annexb_avc_len_size4(sample.data);
                }
                if (valid)
                    opt.stream.trigger('data', sample);
                max_dcd = pos+sz-b_start;
            }
            else if (pos+sz>b_end&&i==this.v_idx)
                v_fin = true;
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
        r = i_ss ? elm.s_sync.length : elm.s_time.length;
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
                m_time = elm.s_time[sn]+(elm.s_ctts[sn]|0);
                if (m_time > ((elm.s_cslg&&elm.s_cslg.min_ctts)|0) &&
                    m_time<tt)
                {
                    tt = m_time;
                }
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
    while (c_len+this.b_size>this._buff.length)
    {
        _newbuff = new Uint8Array(2*this._buff.length);
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
        return new MP4ParserStream(opt);
    MP4ParserStream.prototype.init.call(this);
    this.buffer = new Buffer();
    this.b_parser = new Box_parser();
    this.c_parser = new Chunk_parser(opt);
    this.on('confupdate', function(conf){
        this.c_parser.conf_update(conf);
    });
    this.metadata = {};
    this.buffer.pos = opt.pos||0;
    if (opt.metadata)
    {
        this.metadata.h_parsed = true;
        this.c_parser.s_info = opt.metadata.s_info.slice();
        this.c_parser.s_p = opt.metadata.s_p.slice();
        this.c_parser.v_idx = opt.metadata.v_idx;
    }
};
MP4ParserStream.prototype = new Stream();
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
    this.trigger('data', {type: 'seek'});
    var seek_info = this.c_parser.seek(time, use_ssync);
    this.buffer.pos = seek_info.offset;
    return seek_info;
};

var AudioFilterStream = function(){
    if (!(this instanceof AudioFilterStream))
        return new AudioFilterStream();
    AudioFilterStream.prototype.init.call(this);
};
AudioFilterStream.prototype = new Stream();
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
VideoFilterStream.prototype = new Stream();
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
        return new MP4BuilderStream(opt);
    MP4BuilderStream.prototype.init.call(this);
    this.options = opt||{};
    this.tracks = {};
    this.options.no_multi_init = true;
    this.options.major = new Uint8Array([105, 115, 111, 53]); // 'iso5'
    this.options.compatible = [new Uint8Array([105, 115, 111, 54])]; // 'iso6'
    this.options.set_duration = true;
    this.on('confupdate', function(conf){
        this.options.break_on_count = conf.break_on_count; });
    this.metadata = opt.metadata;
    this.inited = !!this.metadata;
};
MP4BuilderStream.prototype = new Stream();
MP4BuilderStream.prototype.constructor = MP4BuilderStream;
MP4BuilderStream.prototype.push = function(packet){
    var id;
    if (packet.type=='metadata')
        return void (this.metadata = packet);
    if (packet.type=='seek')
    {
        for (id in this.tracks)
            this.tracks[id].samples = [];
        return;
    }
    id = packet.trackId;
    this.tracks[id] = this.tracks[id]||{samples: [], seqno: 0, sc: 0,
        type: packet.type};
    var sample = {
        duration: packet.duration,
        size: packet.size,
        dts: packet.dts,
        pts: packet.pts,
        data: new Uint8Array(packet.data),
        sn: packet.sn,
    };
    if (packet.type=='video')
    {
        var scale = 90000/packet.ts;
        sample.duration = Math.floor(sample.duration*scale);
        sample.pts = Math.floor(sample.pts*scale);
        sample.dts = Math.floor(sample.dts*scale);
        sample.flags = {
            dependsOn: (sample.dep&&sample.dep.dep)|0,
            isDependedOn: (sample.dep&&sample.dep.is_dep)|0,
            hasRedundancy: ((sample.dep&&sample.dep.red)|0) || 2*packet.synced,
            isLeading: (sample.dep&&sample.dep.lead)|0,
        };
        if (!this.options.break_on_count)
            sample.flags.isNonSyncSample = +!packet.synced;
        sample.compositionTimeOffset = sample.pts-sample.dts;
    }
    packet.data = null;
    this.tracks[id].samples.push(sample);
};
MP4BuilderStream.prototype.flush = function(){
    var moof, mdat, seg_sz, _this = this;
    if (!this.inited)
    {
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
                tr.width = tr.track_width;
                tr.height = tr.track_height;
                tr.sps = tr.dr.avcc.sps.map(function(e){ return e.nal; });
                tr.pps = tr.dr.avcc.pps.map(function(e){ return e.nal; });
                break;
            case 'audio':
                tr.samplesize = tr.dr.s_size;
                tr.audioobjecttype = tr.dr.esds.aot;
                tr.samplingfrequencyindex = tr.dr.esds.freq;
                tr.channelcount = tr.dr.esds.channel;
            }
            inits.push({
                id: tr.id,
                buffer: mp4.initSegment([tr], _this.options),
            });
        });
        this.trigger('data', {init: true, inits: inits});
    }
    for (var id in this.tracks)
    {
        var track = this.tracks[id];
        if (!track.samples.length)
            continue;
        var seg_slice = track.samples;
        seg_sz = seg_slice.reduce(function(a, b){
            return a+b.data.length; }, 0);
        moof = mp4.moof(++track.seqno, [{
            id: id,
            baseMediaDecodeTime: seg_slice[0].dts,
            samples: seg_slice,
            type: track.type,
        }], _this.options);
        var segment = new Uint8Array(8+seg_sz+moof.length);
        var sd = new Uint8Array(seg_sz);
        var offset = 0;
        for (var i=0; i<seg_slice.length; i++)
        {
            sd.set(seg_slice[i].data, offset);
            offset += seg_slice[i].data.length;
        }
        mdat = mp4.mdat(sd);
        segment.set(moof);
        segment.set(mdat, moof.length);
        segment.sn = seg_slice[seg_slice.length-1].sn;
        sd = mdat = moof = null;
        this.tracks[id].sc += seg_slice.length;
        this.trigger('data', {id: id, data: segment,
            sc: this.tracks[id].sc});
        this.tracks[id].samples = [];
    }
    this.trigger('done');
};

module.exports = {
  MP4ParserStream: MP4ParserStream,
  AudioFilterStream: AudioFilterStream,
  VideoFilterStream: VideoFilterStream,
  MP4BuilderStream: MP4BuilderStream,
};
