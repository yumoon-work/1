
// =============================================================================
// Site-specific canvas logic (Two.js + Matter.js physics playground)
// =============================================================================

var mouse,
    debug = /debug/i.test(window.location.href),
    vector = new Two.Vector,
    entities = [],
    symbols = [],
    cascadeScalar = 5,
    symbolScalar = 1.2,
    sizeScalar = .8,
    wordMaterial = { restitution: .45, friction: .05, frictionStatic: .1 },
    container = document.querySelector("#canvas-container"),
    two = new Two({
        type: Two.Types.canvas,
        fullscreen: true,
        ratio: Math.min(window.devicePixelRatio || 1, 2)
    }).appendTo(document.querySelector("#canvas-container"))
    /*
    , two = new Two({
        type: Two.Types.canvas,
        width: container.clientWidth,
        height: container.clientHeight
    })
    */,
    dimensions = {
        width: two.width,
        height: two.height
    },
    solver = Matter.Engine.create();

solver.world.gravity.y = 2.2;

var bounds = {
    thickness: 50,
    properties: {
        isStatic: true,
        restitution: .3
    }
};

bounds.left = createBoundary(bounds.thickness, two.height + bounds.thickness);
bounds.right = createBoundary(bounds.thickness, two.height + bounds.thickness);
bounds.bottom = createBoundary(two.width + bounds.thickness, bounds.thickness);
bounds.top = createBoundary(two.width + bounds.thickness, bounds.thickness);
Matter.World.add(solver.world, [bounds.left.entity, bounds.right.entity, bounds.bottom.entity, bounds.top.entity]);

var LETTER_COLORS = [
    "#52A1DB", "#BFBFC1", "#004DB0", "#E74F78", "#4B2455",
    "#4E5900", "#8A298F", "#E73B22", "#FFB304", "#D5B687",
    "#F578C6", "#00963E", "#F67500", "#7D4929", "#7D001F"
];

var defaultStyles = {
    size: getFontSize(),
    weight: 400,
    fill: "white",
    leading: getFontSize(),
    family: "suisse, FoundersGrotesk, Helvetica Neue, sans-serif",
    margin: {
        top: 5,
        left: 10,
        right: 15,
        bottom: 5
    }
};

function setup() {
    setupSymbols();
    addLetters();
    resize();
    mouse = addMouseInteraction();
    two.bind("resize", resize);

    window.addEventListener("deviceorientation", function(e) {
        // Desktop Chrome fires a single synthetic deviceorientation event
        // with beta/gamma set to null on hardware that has no real
        // orientation sensor. clamp(null, -90, 90) coerces null to 0 and
        // returns 0, which silently zeroes out gravity - motion still
        // works via existing velocity/collisions, but nothing ever
        // accelerates downward again. Desktop Safari doesn't fire this
        // event at all without an explicit permission grant, which is why
        // gravity only broke in Chrome. Ignore events with no real reading.
        if ("number" != typeof e.beta || "number" != typeof e.gamma) return;

        var orientation = void 0 !== window.orientation ? window.orientation : 0,
            gravity = solver.world.gravity;

        if (0 === orientation) {
            gravity.x = clamp(e.gamma, -90, 90) / 90;
            gravity.y = clamp(e.beta, -90, 90) / 90;
        } else if (180 === orientation) {
            gravity.x = clamp(e.gamma, -90, 90) / 90;
            gravity.y = clamp(-e.beta, -90, 90) / 90;
        } else if (90 === orientation) {
            gravity.x = clamp(e.beta, -90, 90) / 90;
            gravity.y = clamp(-e.gamma, -90, 90) / 90;
        } else if (-90 === orientation) {
            gravity.x = clamp(-e.beta, -90, 90) / 90;
            gravity.y = clamp(e.gamma, -90, 90) / 90;
        }
    }, false);

    two.playing = true;
    Matter.Events.on(solver, "afterUpdate", update);
    startFixedStepLoop();

    var footerEl = document.querySelector("footer");
    if (footerEl && "undefined" != typeof ResizeObserver) {
        new ResizeObserver(resize).observe(footerEl);
    }
}

// Drives the physics engine on a fixed timestep tied to real elapsed time,
// instead of Matter.Runner's default of deriving the step from measured
// requestAnimationFrame timing. Chrome and Safari (and different display
// refresh rates) fire rAF at different real cadences with different jitter;
// feeding that straight into the engine made gravity/fall speed and
// impulse-driven forces (drag throws, the double-tap explode) diverge
// noticeably between browsers. Fixed-step keeps both identical.
function startFixedStepLoop() {
    var FIXED_DELTA = 1000 / 60,
        MAX_SUBSTEPS = 5,
        accumulator = 0,
        lastTime = null,
        raf = window.requestAnimationFrame || function(cb) { return window.setTimeout(cb, FIXED_DELTA) };

    function frame(time) {
        if (null !== lastTime) {
            accumulator += Math.min(time - lastTime, 250);
        }
        lastTime = time;

        try {
            for (var steps = 0; accumulator >= FIXED_DELTA && steps < MAX_SUBSTEPS; steps++) {
                Matter.Engine.update(solver, FIXED_DELTA);
                accumulator -= FIXED_DELTA;
            }
            // If a frame can't afford MAX_SUBSTEPS worth of sim time (slow
            // device, heavy canvas repaint, GC pause), drop the remaining
            // backlog instead of carrying it into future frames. Without
            // this, a browser that's consistently too slow to pay down
            // accumulator never recovers - the deficit compounds frame over
            // frame and the whole simulation permanently runs in slow
            // motion relative to wall-clock time.
            if (accumulator >= FIXED_DELTA) accumulator = 0;
        } catch (err) {
            // Never let a single bad physics step permanently freeze the
            // canvas (an uncaught throw here previously killed the loop
            // outright, since nothing after it would run raf(frame) again).
            console.error("physics step failed, continuing:", err);
            accumulator = 0;
        }

        raf(frame);
    }

    raf(frame);
}

function setupSymbols() {
    symbols.index = 0;

    var images = document.querySelectorAll("#interactive__images > *");
    for (var i = 0; i < images.length; i++) {
        var src = images[i].getAttribute("svg-src"),
            group = new Two.Group,
            texture = new Two.Texture(src, symbolLoaded(group)),
            sprite = new Two.Sprite(texture);

        sprite.scale = .5;
        group.add(sprite);
        symbols.push(group);
    }
}

function symbolLoaded(group) {
    return function() {
        symbols.isReady = true;
        group.rect = group.getBoundingClientRect();
        group.rect.ratio = group.rect.width / group.rect.height;
        group.isReady = true;
    };
}

function getFloorY() {
    var footerEl = document.querySelector("footer"),
        footerHeight = footerEl ? footerEl.getBoundingClientRect().height : 0;
    return Math.max(two.height - footerHeight, 0);
}

function resize() {
    var thickness = bounds.thickness,
        wideDim = 1.25 * two.width,
        tallDim = 1.25 * two.height;

    // Left wall
    vector.x = two.width / 2 - two.width / 2 - thickness / 2;
    vector.y = two.height / 2;
    Matter.Body.setPosition(bounds.left.entity, vector);
    Matter.Body.scale(bounds.left.entity, 1 / bounds.left.entity.scale.x, 1 / bounds.left.entity.scale.y);
    Matter.Body.scale(bounds.left.entity, thickness, tallDim);
    bounds.left.entity.scale.x = thickness;
    bounds.left.entity.scale.y = tallDim;

    // Right wall
    vector.x = two.width / 2 + two.width / 2 + thickness / 2;
    vector.y = two.height / 2;
    Matter.Body.setPosition(bounds.right.entity, vector);
    Matter.Body.scale(bounds.right.entity, 1 / bounds.right.entity.scale.x, 1 / bounds.right.entity.scale.y);
    Matter.Body.scale(bounds.right.entity, thickness, tallDim);
    bounds.right.entity.scale.x = thickness;
    bounds.right.entity.scale.y = tallDim;

    // Floor
    vector.x = two.width / 2;
    vector.y = getFloorY() + thickness / 2;
    Matter.Body.setPosition(bounds.bottom.entity, vector);
    Matter.Body.scale(bounds.bottom.entity, 1 / bounds.bottom.entity.scale.x, 1 / bounds.bottom.entity.scale.y);
    Matter.Body.scale(bounds.bottom.entity, wideDim, thickness);
    bounds.bottom.entity.scale.x = wideDim;
    bounds.bottom.entity.scale.y = thickness;

    // Ceiling
    vector.x = two.width / 2;
    vector.y = -thickness / 2;
    Matter.Body.setPosition(bounds.top.entity, vector);
    Matter.Body.scale(bounds.top.entity, 1 / bounds.top.entity.scale.x, 1 / bounds.top.entity.scale.y);
    Matter.Body.scale(bounds.top.entity, wideDim, thickness);
    bounds.top.entity.scale.x = wideDim;
    bounds.top.entity.scale.y = thickness;

    two.renderer.domElement.setAttribute("data-pixel-ratio", two.renderer.ratio);

    var letterCount = 0;
    for (var j = 0; j < two.scene.children.length; j++) {
        if (two.scene.children[j].isLetter) letterCount++;
    }

    var fontSize = getFontSize(letterCount),
        leading = .8 * fontSize;

    for (var i = 0; i < two.scene.children.length; i++) {
        var child = two.scene.children[i];
        if (!(child.isWord || child.isLetter || child.isSymbol)) continue;

        var box,
            text = child.text,
            rectangle = child.rectangle,
            entity = child.entity;

        if (text) {
            text.size = fontSize;
            text.leading = leading;
            box = text.getBoundingClientRect(true);
        } else {
            box = {
                width: child.rect.width * (fontSize * symbolScalar) / 300,
                height: child.rect.height * (fontSize * symbolScalar) / 300
            };
            child.destinationScale = fontSize * symbolScalar / 300;
        }

        rectangle.width = box.width;
        rectangle.height = box.height;
        Matter.Body.scale(entity, 1 / entity.scale.x, 1 / entity.scale.y);
        Matter.Body.scale(entity, box.width, box.height);

        vector.x = two.width * entity.position.x / dimensions.width;
        vector.y = two.height * entity.position.y / dimensions.height;
        entity.scale.set(box.width, box.height);
        Matter.Body.setPosition(entity, vector);
    }

    dimensions.width = two.width;
    dimensions.height = two.height;
}

function update() {
    var floorY = getFloorY();

    for (var i = 0; i < entities.length; i++) {
        var entity = entities[i],
            object = entity.object;

        containEntity(entity, floorY);
        object.position.copy(entity.position);
        object.rotation = entity.angle;

        if (object.isSymbol) {
            var delta = object.destinationScale - object.scale;
            if (delta < .01 && delta > -.01) {
                object.scale = object.destinationScale;
            } else {
                object.scale += .66 * (object.destinationScale - object.scale);
            }
        }
    }
    two.render();
}

// Matter.js uses discrete (non-continuous) collision detection: a body
// moving fast enough within a single step - as a hard mouse-drag flick
// easily produces - can cross the wall/floor's full thickness in one
// step and skip past the collision check entirely (classic tunneling).
// This runs every physics step as a hard safety net: if a body's actual
// AABB (which accounts for its current rotation) has crossed a boundary
// anyway, snap it back flush and zero the offending velocity component
// so it doesn't immediately tunnel again next step.
//
// Gated on speed rather than firing for every overlap: resting/settling
// bodies are already kept out of the walls fine by Matter's normal
// collision resolution, and a rotated body's AABB naturally grazes the
// floor by a few px as it settles. Correcting that as if it were
// tunneling fought Matter's own resolution every frame (hard snap, zero
// velocity, gravity pulls it back down, snap again...), which is what
// read as vibration. Tunneling only happens when a body crosses the
// wall's full thickness within one step, which requires real speed - a
// slow/resting body can't have tunneled, so it's skipped entirely.
var CONTAIN_SPEED_THRESHOLD = 10;

function containEntity(entity, floorY) {
    if (entity.speed < CONTAIN_SPEED_THRESHOLD) return;

    var dx = 0, dy = 0;

    if (entity.bounds.min.x < 0) dx = -entity.bounds.min.x;
    else if (entity.bounds.max.x > two.width) dx = two.width - entity.bounds.max.x;

    if (entity.bounds.min.y < 0) dy = -entity.bounds.min.y;
    else if (entity.bounds.max.y > floorY) dy = floorY - entity.bounds.max.y;

    if (!dx && !dy) return;

    vector.x = entity.position.x + dx;
    vector.y = entity.position.y + dy;
    Matter.Body.setPosition(entity, vector);
    Matter.Body.setVelocity(entity, {
        x: dx ? 0 : entity.velocity.x,
        y: dy ? 0 : entity.velocity.y
    });
}

// Breaks the bio sentence into individual lowercase letters and lays them
// out on a grid (not randomly scattered) so none overlap at spawn - a
// randomly-scattered spawn at this letter count and size was dense enough
// to jam Matter's solver into a locked pile that resisted gravity.
// getFontSize(chars.length) shrinks the letters as needed so every row
// fits within the visible canvas at spawn (see getFontSize()); a ceiling
// wall (see resize()) additionally keeps anything later flung upward by a
// drag or the double-tap explode from escaping the top.
function addLetters() {
    var raw = document.querySelector("#interactive__text").textContent,
        chars = raw.replace(/\s+/g, "").split("").concat(["?", "?"]);

    shuffle(chars);

    // Cycle through the palette so every color is used as evenly as
    // possible across however many letters there are, then shuffle so
    // which color lands on which letter (and where) is random per load.
    var colors = [];
    for (var c = 0; c < chars.length; c++) colors.push(LETTER_COLORS[c % LETTER_COLORS.length]);
    shuffle(colors);

    var size = getFontSize(chars.length),
        cell = size * .9,
        jitter = cell * .15,
        margin = 0,
        usableWidth = Math.max(two.width - margin * 2, cell),
        columns = Math.max(Math.floor(usableWidth / cell), 1),
        // Stretch column spacing to exactly divide usableWidth so the grid
        // reaches both edges evenly - using the raw `cell` value here would
        // leave columns * cell short of usableWidth (floor() rounds down),
        // stranding that leftover gap entirely on the right since the grid
        // fills left-to-right from the margin.
        colWidth = usableWidth / columns;

    for (var k = 0; k < chars.length; k++) {
        try {
            var col = k % columns,
                row = Math.floor(k / columns),
                group = new Two.Group,
                label = new Two.Text(chars[k].toLowerCase(), 0, 0, defaultStyles);

            label.size = size;
            label.leading = size;
            label.fill = colors[k];

            var box = label.getBoundingClientRect(true),
                x = margin + colWidth / 2 + col * colWidth + (Math.random() - .5) * jitter,
                y = size + row * cell + (Math.random() - .5) * jitter;

            // colWidth is a uniform per-column estimate, but glyph widths
            // vary (an "m" is much wider than an "i") - a wide letter
            // landing in the first or last column can have its own box
            // wider than that column's share, poking past the canvas edge
            // at spawn. Clamp to the letter's own measured width instead.
            x = clamp(x, box.width / 2, two.width - box.width / 2);

            // Nudges the glyph down within its (crude, non-descender-aware)
            // bounding box so it reads as vertically centered. Scaled with
            // font size rather than a fixed pixel value - a fixed offset is
            // proportionally larger at small sizes, pushing descenders
            // (g, y, p, q, j) past the bottom of their box.
            label.translation.y = size * .1;
            group.isLetter = true;
            group.translation.x = x;
            group.translation.y = y;

            var outline = new Two.Rectangle(0, 0, box.width, box.height);
            outline.stroke = "rgb(green)";
            outline.noFill();
            outline.opacity = .75;
            outline.visible = debug;

            var body = Matter.Bodies.rectangle(x, y, 1, 1, wordMaterial);
            Matter.Body.scale(body, box.width, box.height);
            Matter.Body.rotate(body, Math.random() * Math.PI * 2);
            body.scale = new Two.Vector(box.width, box.height);
            body.object = group;
            entities.push(body);

            group.text = label;
            group.rectangle = outline;
            group.entity = body;
            group.add(label, outline);
            two.add(group);
        } catch (err) {
            console.error("addLetters: skipped character " + JSON.stringify(chars[k]), err);
        }
    }

    Matter.World.add(solver.world, entities);
}

function addMouseInteraction() {
    var draggedBody,
        docBody = document.body,
        mouseSource = Matter.Mouse.create(docBody),
        constraint = Matter.MouseConstraint.create(solver, {
            mouse: mouseSource,
            constraint: {
                stiffness: .2
            }
        }),
        lastClickTime = 0,
        isTouchDrag = false,
        isHeaderInteraction = false,
        header = document.body.querySelector("header"),
        touchOpts = {
            passive: false
        },
        touchListenersActive = true;

    // header is optional markup (used to exclude nav clicks from the canvas
    // interaction); without it, nothing on the page counts as "over the
    // header" and everything falls through to the canvas as before.
    function getHeaderBottom() {
        return header ? header.getBoundingClientRect().bottom : 0;
    }

    // Any tap/click that starts on a real link (footer nav, intro credits,
    // email) should never be captured by the canvas drag/physics handling,
    // regardless of where on the page it sits.
    function isLinkTarget(e) {
        var target = e.target;
        return !!(target && typeof target.closest === "function" && target.closest("a"));
    }

    function removeTouchListeners() {
        Matter.Mouse.clearSourceEvents(mouseSource);
        docBody.removeEventListener("touchmove", mouseSource.mousemove, touchOpts);
        docBody.removeEventListener("touchstart", mouseSource.mousedown, touchOpts);
        docBody.removeEventListener("touchend", mouseSource.mouseup, touchOpts);
        touchListenersActive = false;
    }

    // Start with Matter's default touch handling disabled; it's only
    // re-enabled per-touch below once we know the touch isn't over the header.
    removeTouchListeners();

    docBody.addEventListener("dblclick", function(e) {
        if (!isHeaderInteraction) {
            if (draggedBody) {
                cascade(mouseSource.position);
                explode(draggedBody);
            }
            draggedBody = null;
        }
    }, false);

    docBody.addEventListener("mousedown", function(e) {
        isHeaderInteraction = e.clientY < getHeaderBottom() || isLinkTarget(e);
        isTouchDrag = false;
        draggedBody = null;
    }, false);

    docBody.addEventListener("touchstart", function(e) {
        isHeaderInteraction = (!!(e.touches && e.touches.length > 0) && e.touches[0].clientY < getHeaderBottom()) || isLinkTarget(e);

        if (isHeaderInteraction) {
            removeTouchListeners();
        } else if (!touchListenersActive) {
            mouseSource.mousedown(e);
            docBody.addEventListener("touchmove", mouseSource.mousemove, touchOpts);
            docBody.addEventListener("touchstart", mouseSource.mousedown, touchOpts);
            docBody.addEventListener("touchend", mouseSource.mouseup, touchOpts);
            touchListenersActive = true;
        }

        isTouchDrag = true;
        draggedBody = null;
    }, false);

    Matter.Events.on(constraint, "mousedown", function(e) {
        if (!isHeaderInteraction && !draggedBody && symbols.isReady) {
            injectSymbol(mouseSource.position);
        }
    });

    Matter.Events.on(constraint, "startdrag", function(e) {
        if (!isHeaderInteraction && (draggedBody = e.source.body, isTouchDrag)) {
            var now = Date.now();
            if (now - lastClickTime <= 300 && draggedBody) {
                cascade(mouseSource.position);
                explode(draggedBody);
            }
            lastClickTime = now;
        }
    });

    Matter.World.add(solver.world, constraint);
    return constraint;
}

function explode(body) {
    if (body.object.isSymbol) return;

    var group = body.object,
        chars = group.text.value.split(""),
        textBox = group.text.getBoundingClientRect(true),
        angle = body.angle,
        newBodies = [],
        index = getIndex(body);

    if (index >= 0) entities.splice(index, 1);

    for (var i = 0; i < chars.length; i++) {
        var t = (i + .5) / chars.length,
            char = chars[i],
            letterGroup = new Two.Group;

        letterGroup.isLetter = true;

        var label = group.text.clone();
        label.value = char;

        var box = label.getBoundingClientRect(true),
            offset = t * textBox.width - textBox.width / 2,
            x = body.position.x + offset * Math.cos(angle),
            y = body.position.y + offset * Math.sin(angle);

        letterGroup.translation.x = x;
        letterGroup.translation.y = y;
        // See addLetters() for why this is proportional rather than fixed.
        label.translation.y = label.size * .1;

        var outline = new Two.Rectangle(0, 0, box.width, box.height);
        outline.stroke = "rgb(green)";
        outline.noFill();
        outline.opacity = .75;
        outline.visible = debug;

        var letterBody = Matter.Bodies.rectangle(x, y, 1, 1, wordMaterial);
        Matter.Body.scale(letterBody, box.width, box.height);
        Matter.Body.rotate(letterBody, angle);
        Matter.Body.setMass(letterBody, 2.5);

        var burstAngle = t * Math.PI * 2;
        vector.x = .33 * Math.cos(burstAngle);
        vector.y = .33 * Math.sin(burstAngle);
        Matter.Body.applyForce(letterBody, letterBody.position, vector);

        letterBody.scale = new Two.Vector(box.width, box.height);
        letterBody.object = letterGroup;
        entities.push(letterBody);
        newBodies.push(letterBody);

        letterGroup.text = label;
        letterGroup.rectangle = outline;
        letterGroup.entity = letterBody;
        letterGroup.add(label, outline);
        two.add(letterGroup);
    }

    Matter.World.remove(solver.world, group.entity);
    group.remove();
    Two.Utils.release(group);
    Matter.World.add(solver.world, newBodies);
}

function injectSymbol(position) {
    var size = getFontSize() * symbolScalar,
        template = getNextSymbol(),
        symbol = template.clone(),
        newBodies = [];

    symbol.isSymbol = true;
    symbol.symbol = getPathFromSVG(symbol);
    symbol.symbol.scale = .5;

    var x = position.x,
        y = position.y,
        box = {
            width: template.rect.width * (size * symbolScalar) / 300,
            height: template.rect.height * (size * symbolScalar) / 300
        };

    symbol.scale = 0;
    symbol.destinationScale = size * symbolScalar / 300;
    symbol.rect = template.rect;
    symbol.position.set(x, y);

    var outline = new Two.Rectangle(0, 0, template.rect.width, template.rect.height);
    outline.stroke = "rgb(green)";
    outline.noFill();
    outline.opacity = .75;
    outline.visible = debug;

    var tilt = Math.random() * Math.PI / 16 - Math.PI / 32,
        body = Matter.Bodies.rectangle(x, y, 1, 1, wordMaterial);

    Matter.Body.scale(body, box.width, box.height);
    Matter.Body.rotate(body, tilt);
    Matter.Body.setMass(body, 2.5);
    body.scale = new Two.Vector(box.width, box.height);
    body.object = symbol;
    entities.push(body);
    newBodies.push(body);

    symbol.rectangle = outline;
    symbol.entity = body;
    symbol.add(outline);
    two.add(symbol);

    Matter.World.add(solver.world, newBodies);
}

function getPathFromSVG(group) {
    for (var i = 0; i < group.children.length; i++) {
        var child = group.children[i];
        if (/path/i.test(child._renderer.type)) return child;
    }
    return null;
}

function getNextSymbol() {
    var symbol = symbols[symbols.index];
    symbols.index = (symbols.index + 1) % symbols.length;
    return symbol.isReady ? symbol : getNextSymbol();
}

function cascade(origin) {
    for (var i = 0; i < entities.length; i++) {
        var entity = entities[i],
            dx = entity.position.x - origin.x,
            dy = entity.position.y - origin.y,
            angle = Math.atan2(dy, dx),
            distance = Math.sqrt(dx * dx + dy + dy),
            magnitude = cascadeScalar / distance;

        if (!magnitude) magnitude = 1;

        vector.x = magnitude * Math.cos(angle);
        vector.y = magnitude * Math.sin(angle);
        Matter.Body.applyForce(entity, entity.position, vector);
    }
}

function release(body) {
    vector.x = 0;
    vector.y = 0;
    Matter.Body.setStatic(body, false);
    Matter.Body.applyForce(body, body.position, vector);
}

function createBoundary(width, height) {
    var shape = two.makeRectangle(0, 0, width, height);
    shape.visible = debug;

    var body = Matter.Bodies.rectangle(0, 0, 1, 1, bounds.properties);
    Matter.Body.scale(body, width, height);
    body.position = shape.position;
    body.scale = new Two.Vector(width, height);
    shape.entity = body;
    return shape;
}

function getIndex(body) {
    for (var i = 0; i < entities.length; i++) {
        if (entities[i].id === body.id) return i;
    }
    return -1;
}

// letterCount, when given, additionally shrinks the base ratio-derived size
// as needed so that many letters (currently 4 full alphabets + 4 "?") still
// fit on a non-overlapping grid entirely within the visible canvas. Without
// this, a fixed letter count at the "natural" size can need more vertical
// room than fits between the top and the floor, which used to be fine (the
// grid was allowed to run past the bottom and fall into place) but means
// letters visibly spawn off-canvas, which addLetters()/resize() now avoid.
function getFontSize(letterCount) {
    var width = two.width,
        ratio = two.height / two.width,
        size = getBaseFontSize(width, ratio);

    if (!letterCount) return size;

    var usableWidth = Math.max(width, 1),
        usableHeight = Math.max(getFloorY(), 1);

    for (;;) {
        var cell = size * .9,
            columns = Math.max(Math.floor(usableWidth / cell), 1),
            rows = Math.ceil(letterCount / columns);

        if (size + rows * cell <= usableHeight || size <= 4) break;
        size *= .95;
    }

    return size;
}

function getBaseFontSize(width, ratio) {
    if (ratio > 2) return sizeScalar * .14 * width;
    if (ratio > 1.75 && ratio < 2.01) return sizeScalar * .14 * width;
    if (ratio > 1.5 && ratio < 1.76) return sizeScalar * .12 * width;
    if (ratio > 1.25 && ratio < 1.51) return sizeScalar * .11 * width;
    if (ratio > 1 && ratio < 1.26) return sizeScalar * .105 * width;
    if (ratio > .9 && ratio < 1.01) return sizeScalar * .095 * width;
    if (ratio > .7 && ratio < .91) return sizeScalar * .085 * width;
    if (ratio > .6 && ratio < .71) return sizeScalar * .08 * width;
    if (ratio > .5 && ratio < .61) return sizeScalar * .075 * width;
    if (ratio > .45 && ratio < .51) return sizeScalar * .07 * width;
    if (ratio > .4 && ratio < .46) return sizeScalar * .065 * width;
    if (ratio > .35 && ratio < .41) return sizeScalar * .06 * width;
    if (ratio > .3 && ratio < .36) return sizeScalar * .055 * width;
    if (ratio > .25 && ratio < .31) return sizeScalar * .05 * width;
    if (ratio > .2 && ratio < .26) return sizeScalar * .045 * width;
    if (ratio > .1 && ratio < .11) return sizeScalar * .032 * width;
    return sizeScalar * .03 * width;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// Fisher-Yates, in place. Used to randomize which character lands in each
// grid cell (see addLetters()) while keeping the non-overlapping grid
// layout itself - a fully free-scatter spawn was tried before and was
// dense enough to jam Matter's solver into a locked pile that resisted
// gravity.
function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1)),
            temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}

// Word/letter physics-body sizes and the floor position are measured from
// actual rendered text (getBoundingClientRect on the custom "suisse" font,
// and the footer's own height). Starting setup() before that font has
// finished loading bakes in fallback-font metrics - sized and positioned
// wrong once the real font swaps in. Browsers race this differently
// (Chrome vs Safari), which is why behavior diverged on refresh.
function startWhenFontsReady() {
    if (!document.fonts || !document.fonts.ready) return void setup();

    // Race against a timeout: if font loading is ever slow or stuck (seen
    // with some local file:// setups), don't leave the canvas empty forever.
    var timeout = new Promise(function(resolve) { window.setTimeout(resolve, 2000) });
    Promise.race([document.fonts.ready, timeout]).then(setup).catch(function(err) {
        // Without this, a throw inside setup() surfaces only as a vague
        // "Uncaught (in promise) TypeError" with no indication of which
        // line in setup()'s call chain (addLetters/resize/addMouseInteraction/
        // etc.) actually failed.
        console.error("setup() failed:", err.stack || err);
    });
}

startWhenFontsReady();
