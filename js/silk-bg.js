// Shared animated "silk" background (vanilla WebGL, no dependencies).
// Injects a fixed full-viewport canvas behind all page content.
// Ported from the React Bits <Silk /> component (same GLSL shaders).
(function () {
  if (window.__silkBgInit) return;
  window.__silkBgInit = true;

  function start() {
    if (document.getElementById('silk-bg')) return;

    var canvas = document.createElement('canvas');
    canvas.id = 'silk-bg';
    canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
    document.body.insertBefore(canvas, document.body.firstChild);

    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return;

    var vert = [
      'attribute vec2 aPos;',
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = aPos * 0.5 + 0.5;',
      '  gl_Position = vec4(aPos, 0.0, 1.0);',
      '}'
    ].join('\n');

    var frag = [
      'precision mediump float;',
      'varying vec2 vUv;',
      'uniform float uTime;',
      'uniform vec3  uColor;',
      'uniform float uSpeed;',
      'uniform float uScale;',
      'uniform float uRotation;',
      'uniform float uNoiseIntensity;',
      'const float e = 2.71828182845904523536;',
      'float noise(vec2 tc){',
      '  float G=e;',
      '  vec2 r=(G*sin(G*tc));',
      '  return fract(r.x*r.y*(1.0+tc.x));',
      '}',
      'vec2 rotateUvs(vec2 uv,float angle){',
      '  float c=cos(angle); float s=sin(angle);',
      '  mat2 rot=mat2(c,-s,s,c);',
      '  return rot*uv;',
      '}',
      'void main(){',
      '  float rnd=noise(gl_FragCoord.xy);',
      '  vec2 uv=rotateUvs(vUv*uScale,uRotation);',
      '  vec2 tex=uv*uScale;',
      '  float tOffset=uSpeed*uTime;',
      '  tex.y+=0.03*sin(8.0*tex.x-tOffset);',
      '  float pattern=0.6+0.4*sin(5.0*(tex.x+tex.y+cos(3.0*tex.x+5.0*tex.y)+0.02*tOffset)+sin(20.0*(tex.x+tex.y-0.1*tOffset)));',
      '  vec4 col=vec4(uColor,1.0)*vec4(pattern)-rnd/15.0*uNoiseIntensity;',
      '  col.a=1.0;',
      '  gl_FragColor=col;',
      '}'
    ].join('\n');

    function makeShader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, makeShader(gl.VERTEX_SHADER, vert));
    gl.attachShader(prog, makeShader(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var uTime     = gl.getUniformLocation(prog, 'uTime');
    var uColor    = gl.getUniformLocation(prog, 'uColor');
    var uSpeed    = gl.getUniformLocation(prog, 'uSpeed');
    var uScale    = gl.getUniformLocation(prog, 'uScale');
    var uRotation = gl.getUniformLocation(prog, 'uRotation');
    var uNoise    = gl.getUniformLocation(prog, 'uNoiseIntensity');

    function hexRgb(hex) {
      hex = hex.replace('#','');
      return [parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255];
    }
    var rgb = hexRgb('#57535B');
    gl.uniform3f(uColor, rgb[0], rgb[1], rgb[2]);
    gl.uniform1f(uSpeed, 5);
    gl.uniform1f(uScale, 1);
    gl.uniform1f(uRotation, 0);
    gl.uniform1f(uNoise, 1.5);

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = window.innerWidth  * dpr;
      canvas.height = window.innerHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    var t = 0, last = null;
    function loop(ts) {
      if (last !== null) t += 0.1 * (ts - last) / 1000;
      last = ts;
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
