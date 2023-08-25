/**
* cytoscape-deep-d3-force
*/

const defaults = require('./defaults');
const d3 = require('d3-force');
const assign = require('./assign');


let oldCountNodes = 0;
let simulation = null;
let activeUUIDTick = '';

class ContinuousLayout {

  constructor(options) {
    let o = this.options = assign({}, defaults, options);
    const focusLinkId = options?.deep()?.idLocal('@deep-foundation/core', 'Focus') || 55
    this.state = assign({}, o, {
      layout: this,
      nodes: o.eles.nodes(),
      edges: o.eles.edges(),
      progress: 0,
      iterations: 0,
      startTime: 0,
      focusLinkId
    });
    this.removeCytoscapeEvents = null;
    this.destroyedEvent = null;
  }

  forceLimit(limit) {
    let nodes;

    function force() {
      for (const node of nodes) {
        const speed = Math.hypot(node.vx, node.vy);
        if (speed > limit) {
          node.vx = node.vx / speed * limit;
          node.vy = node.vy / speed * limit;
        }
      }
    }

    force.limit = function (_) {
      return arguments.length ? (limit = +_, force) : limit;
    };

    force.initialize = function (_) {
      nodes = _;
    };

    return force;
  }

  makeBoundingBox(bb, cy) {
    if (bb == null) {
      bb = { x1: 0, y1: 0, w: cy.width(), h: cy.height() };
    } else {
      bb = { x1: bb.x1, x2: bb.x2, y1: bb.y1, y2: bb.y2, w: bb.w, h: bb.h };
    }
    if (bb.x2 == null) { bb.x2 = bb.x1 + bb.w; }
    if (bb.w == null) { bb.w = bb.x2 - bb.x1; }
    if (bb.y2 == null) { bb.y2 = bb.y1 + bb.h; }
    if (bb.h == null) { bb.h = bb.y2 - bb.y1; }

    return bb;
  }
  hasFocusedLink(node, state) {
    const focus = node?.data()?.link?.in?.find((link) => {
      return link.type_id == state?.focusLinkId
    })
    const hasFocus = !!focus?.id;
    return hasFocus;
  }
  hasHover(node) {
    return node?.classes()?.find((classes) => classes == 'hover');
  }
  setInitialPositionState(node, state) {
    let p = node.position();
    let bb = state.currentBoundingBox;
    let scratch = node.scratch(state.name);

    if (scratch == null) {
      scratch = {};

      node.scratch(state.name, scratch);
    }

    assign(scratch, state.randomize ? {
      x: bb.x1 + Math.round(Math.random() * bb.w),
      y: bb.y1 + Math.round(Math.random() * bb.h)
    } : {
      x: p.x,
      y: p.y,
      old_x: p.x,
      old_y: p.y,
      vx: 0,
      vy: 0,
    });
    if (node.locked()) {
      assign(scratch, {
        fx: p.x,
        fy: p.y
      });
    }
  }

  refreshPositions(nodes, state) {
    const hasHover = (node) => this.hasHover(node);
    const hasFocusedLink = (node, state) => this.hasFocusedLink(node, state);
    try {
      nodes.positions(function (node) {
        let scratch = node.scratch(state.name);
        if (hasHover(node) || hasFocusedLink(node, state)) {
          const { x, y } = node.position();
          assign(scratch, {
            fx: x,
            fy: y,
          });
          return { x, y };
        } else if (!hasHover(node) && !hasFocusedLink(node, state)) {
          assign(scratch, {
            fx: undefined,
            fy: undefined
          });
        }
        assign(scratch, {
          old_x: scratch.x,
          old_y: scratch.y,
        })
        return {
          x: scratch.x,
          y: scratch.y
        };
      });
    } catch (e) {
      // console.log(e);
    }

  }

  getScratch(el) {
    let name = this.state.name;
    let scratch = el.scratch(name);

    if (!scratch) {
      scratch = {};

      el.scratch(name, scratch);
    }
    return scratch;
  }

  ungrabify(nodes) {
    if (!this.state.ungrabifyWhileSimulating) { return; }
    nodes.filter(node => {
      let nodeGrabbable = this.getScratch(node).grabbable = node.grabbable();
      return nodeGrabbable;
    });
    nodes.ungrabify();
  }

  regrabify(nodes) {
    if (!this.state.ungrabifyWhileSimulating) { return; }
    nodes.filter(node => {
      let nodeGrabbable = this.getScratch(node).grabbable;
      return nodeGrabbable;
    });
    nodes.grabify();
  }

  tick(UUIDTick) {
    if (activeUUIDTick != UUIDTick || !simulation) {
      return;
    }
    const s = this.state;
    s.progress += 1 / Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
    s.iterations++;
    let _iterations = s.maxIterations && !s.infinite ? s.iterations / s.maxIterations : 0;
    let _timeRunning = Date.now() - s.startTime;
    let _timeIterations = s.maxSimulationTime && !s.infinite ? _timeRunning / s.maxSimulationTime : 0;
    let _progress = Math.max(_iterations, _timeIterations, s.progress);
    _progress = _progress > 1 ? 1 : _progress;

    let restartAlphaTarget = Math.abs((this.state.alpha || 1) - (this.state.alphaTarget || 0)) / 3;
    simulation.alphaTarget(restartAlphaTarget).restart();

    s.tick && s.tick(_progress);
    this.refreshPositions(s.nodes, s);
  }

  end(destroyed) {
    const s = this.state;
    this.refreshPositions(s.nodes, s);
    this.emit('layoutstop', s.cy);
    this.reset(destroyed);

    let restartAlphaTarget = Math.abs((this.state.alpha || 1) - (this.state.alphaTarget || 0)) / 3;
    simulation.alphaTarget(restartAlphaTarget).restart();
  }

  reset(destroyed) {
    // simulation && simulation.stop();
    const s = this.state;
    // this.destroyedEvent && this.destroyedEvent();
    this.regrabify(s.nodes);
    (destroyed || !s.infinite) && this.removeCytoscapeEvents && this.removeCytoscapeEvents();
    if (destroyed) {
      simulation?.stop && simulation.stop()
      simulation = null;
      oldCountNodes = 0;
      activeUUIDTick = '';
    }

    return this;
  }
  run() {
    this.reset();
    let l = this;
    let s = this.state;
    let ready = false;
    s.currentBoundingBox = this.makeBoundingBox(s.boundingBox, s.cy);
    if (s.ready) { l.one('layoutready', s.ready); }
    if (s.stop) { l.one('layoutstop', s.stop); }

    if (!ready) {
      ready = true;
      l.emit('layoutready');
    }
    const countNodes = s.nodes.length;
    if (countNodes > 0 && oldCountNodes != countNodes) {
      oldCountNodes = countNodes;
      s.nodes.forEach(n => this.setInitialPositionState(n, s));
      if (simulation) {
        simulation.stop && simulation.stop();
      }
      let _forcenodes = s.nodes.map(n => assign(l.getScratch(n), n.data()));
      let _forceedges = s.edges.map(e => assign({}, e.data()));
      simulation = d3.forceSimulation(_forcenodes);
      s.alpha && simulation.alpha(s.alpha);
      // s.alphaMin && simulation.alphaMin(s.alphaMin);
      // s.alphaDecay && simulation.alphaDecay(s.alphaDecay);
      // s.alphaTarget && simulation.alphaTarget(s.alphaTarget);
      // s.velocityDecay && simulation.velocityDecay(s.velocityDecay);
      let _collide = d3.forceCollide();
      s.collideRadius && _collide.radius(s.collideRadius);
      s.collideStrength && _collide.strength(s.collideStrength);
      s.collideIterations && _collide.iterations(s.collideIterations);
      let _link = d3.forceLink(_forceedges);
      s.linkId && _link.id(s.linkId);
      s.linkDistance && _link.distance(s.linkDistance);
      s.linkStrength && _link.strength(s.linkStrength);
      s.linkIterations && _link.iterations(s.linkIterations);
      let _manyBody = d3.forceManyBody();
      s.manyBodyStrength && _manyBody.strength(s.manyBodyStrength);
      s.manyBodyTheta && _manyBody.theta(s.manyBodyTheta);
      s.manyBodyDistanceMin && _manyBody.distanceMin(s.manyBodyDistanceMin);
      s.manyBodyDistanceMax && _manyBody.distanceMax(s.manyBodyDistanceMax);
      let _x = d3.forceX();
      s.xX && _x.x(s.xX);
      s.xStrength && _x.strength(s.xStrength);
      let _y = d3.forceY();
      s.yY && _y.y(s.yY);
      s.yStrength && _y.strength(s.yStrength);
      let _radius = null;
      if (s.radialRadius || s.radialStrength || s.radialX || s.radialY) {
        _radius = d3.forceRadial();
        s.radialRadius && _radius.radius(s.radialRadius);
        s.radialStrength && _radius.strength(s.radialStrength);
        s.radialX && _radius.x(s.radialX);
        s.radialY && _radius.y(s.radialY);
      }
      simulation
        .force('collide', _collide)
        .force('link', _link)
        .force('charge', _manyBody)
        .force('limit', this.forceLimit(100))
        .force('x', _x)
        .force('y', _y);

      _radius && simulation.force('radius', _radius);
      const UUIDTick = crypto.randomUUID();
      activeUUIDTick = UUIDTick;
      simulation
        .on("tick", () => {
          l.tick(UUIDTick);
        })
        .on("end", () => {
          l.end();
        });
    }
    l.prerun(s);
    l.emit('layoutstart');
    s.progress = 0;
    s.iterations = 0;
    s.startTime = Date.now();


    let restartAlphaTarget = Math.abs((s.alpha || 1) - (s.alphaTarget || 0)) / 3;
    const hasHover = (node) => this.hasHover(node);
    if (!l.removeCytoscapeEvents) {
      let _cytoscapeEvent = function (e) {
        if (!simulation) return
        let node = this;
        let pos = node.position();
        let nodeIsTarget = e.cyTarget === node || e.target === node;
        if (!nodeIsTarget) { return; }
        let _scratch = l.getScratch(node);
        s.progress = 0;
        s.iterations = 0;
        s.startTime = Date.now();
        _scratch.x = pos.x;
        _scratch.y = pos.y;

        if (e.type === 'grab') {
          simulation.alphaTarget(restartAlphaTarget).restart();
        } else {
          _scratch.fx = pos.x;
          _scratch.fy = pos.y;
        }
      };
      // let _cytoscapeDestroyEvent = function (e) {
      //   simulation?.stop && simulation.stop();
      // }
      l.removeCytoscapeEvents = function () {
        s.nodes.off('grab drag', _cytoscapeEvent);
        // s.cy.off('destroy', _cytoscapeDestroyEvent);
        l.removeCytoscapeEvents = null;
      };
      s.nodes.on('grab drag', _cytoscapeEvent);
      // s.cy.on('destroy', _cytoscapeDestroyEvent);
    }
    l.ungrabify(s.nodes);

    l.postrun(s);
    return this;
  }


  prerun() { }
  postrun() { }

  stop() {
    return this.reset(true);
  }
}

module.exports = ContinuousLayout;
