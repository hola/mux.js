module.exports = function(grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    clean: {
      files: ['dist']
    },
    concat: {
      options: {
        separator: '',
        process: function(src, filepath) {
          return '// file:' + filepath + '\n' + src;
        },
        stripBanners: true
      },
      mp4: {
        nonull: true,
        src: [
            'lib/stream.js',
            'lib/mp4parser.js',
            'lib/mp4-generator.js',
            'lib/transmuxer.js'
        ],
        dest: 'dist/mux.mp4.js'
      },
    },
  });
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.registerTask('default', ['clean', 'concat:mp4']);
};
