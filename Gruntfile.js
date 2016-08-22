module.exports = function(grunt) {
  let pkg = grunt.file.readJSON('package.json');
  let version = pkg.version;

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
    shell: {
      github: {
        command: [
          'git checkout -b tag-v'+version,
          //'grunt',
          //'git add dist',
          //'git commit -m "add dist v'+version+'"',
          'git tag -a v'+version+' -m "v'+version+'"',
          'git checkout hola_5.0.2-1',
          'git branch -D tag-v'+version,
          'git push --tags origin'
        ].join('&&')
      }
    }
  });
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-shell');
  grunt.registerTask('default', ['clean', 'concat:mp4']);
  grunt.registerTask('release', ['default', 'shell:github']);
};
