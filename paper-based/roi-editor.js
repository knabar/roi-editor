roiEditor = function(element, roiGroupLoader) {
    paper.setup(element);

    var roiGroup = roiGroupLoader();

    var moveAndCheckBounds = function(delta) {
        var bounds = paper.project.activeLayer.bounds.clone();
        delta.x = Math.max(delta.x, paper.view.bounds.width - bounds.width - bounds.x);
        delta.y = Math.max(delta.y, paper.view.bounds.height - bounds.height - bounds.y);
        delta.x = Math.min(delta.x, paper.view.bounds.x - bounds.x);
        delta.y = Math.min(delta.y, paper.view.bounds.y - bounds.y);
        paper.project.activeLayer.translate(delta);
    };

    var modes = ['topLeft', 'topCenter', 'topRight', 'leftCenter', 'rightCenter', 'bottomLeft', 'bottomCenter', 'bottomRight'];

    var selectBox = null;
    var selectedItem;
    var selectedHandle;
    var handles = function() {
        var handles = new paper.Group({ visible: false });
        handles.pathmode = false;
        handles.create = function(pathmode) {
            handles.hide();
            handles.pathmode = pathmode && selectedItem.segments;
            for (var i in (handles.pathmode ? selectedItem.segments : modes)) {
                handles.addChild(new paper.Path.Rectangle(0, 0, 11, 11));
            }
            handles.style = {
                strokeColor: 'black',
                fillColor: 'white'
            };
        };
        handles.update = function() {
            handles.visible = true;
            handles.bringToFront();
            for (var i in handles.children) {
                handles.children[i].position = (handles.pathmode ?
                    selectedItem.segments[i].point : selectBox.bounds[modes[i]]);
            }
        };
        handles.getMode = function(point) {
            for (var i in handles.children) {
                if (handles.children[i].hitTest(point, {'fill': true})) {
                    if (handles.pathmode) {
                        selectedHandle = i;
                        return 'moveNode';
                    } else {
                        return 'resize' + modes[i];
                    }
                }
            }
            return null;
        };
        handles.hide = function() {
            handles.visible = false;
            handles.removeChildren();
        };
        return handles;
    }();

    var selectItem = function(item, pathMode) {
        var pathmode = false;
        if (selectBox) {
            selectBox.remove();
            if (selectedItem == item) {
                pathmode = !handles.pathmode;
            }
        }
        selectedItem = item;
        if (item) {
            handles.create(pathmode);
            selectBox = new paper.Path.Rectangle(item.strokeBounds);
            selectBox.style.strokeColor = 'yellow';
            handles.update();
        } else {
            handles.visible = false;
        }
    };

    var resizeOptions = {
        topLeft: ['bottomRight', -1, -1],
        topCenter: ['bottomCenter', 0, -1],
        topRight: ['bottomLeft', 1, -1],
        leftCenter: ['rightCenter', -1, 0],
        rightCenter: ['leftCenter', 1, 0],
        bottomLeft: ['topRight', -1, 1],
        bottomCenter: ['topCenter', 0, 1],
        bottomRight: ['topLeft', 1, 1]
    };

    var lastHit;
    var dragging = false;
    var mode = null;

    var defaultTool = new paper.Tool({
        'onMouseDrag': function(event) {
            dragging = true;
            if (mode == 'pan') {
                moveAndCheckBounds(event.delta.clone());
            } else if (mode == 'dragShape') {
                selectedItem.position.x += event.delta.x;
                selectedItem.position.y += event.delta.y;
                selectBox.position = selectedItem.position;
                handles.update();
            } else if (mode.indexOf('resize') === 0) {
                var options = resizeOptions[mode.substring(6)];
                var b = selectedItem.bounds;
                var new_width = Math.max(b.width + event.delta.x * options[1], ROI_MIN_SIZE);
                var new_height = Math.max(b.height + event.delta.y * options[2], ROI_MIN_SIZE);
                selectedItem.scale(new_width / b.width, new_height / b.height, selectedItem.bounds[options[0]]);
                selectBox.scale(new_width / b.width, new_height / b.height, selectBox.bounds[options[0]]);
                handles.update();
            } else if (mode == 'moveNode') {
                var p = selectedItem.segments[selectedHandle].point;
                selectedItem.segments[selectedHandle].point = new paper.Point(p.x + event.delta.x, p.y + event.delta.y);
                handles.update();
                selectBox.remove();
                selectBox = new paper.Path.Rectangle(selectedItem.strokeBounds);
                selectBox.style.strokeColor = 'yellow';
            }
        },
        'onMouseMove': function(event) {
            var hit = roiGroup.hitTest(event.point, {'tolerance': 10, 'fill': true, 'stroke': true});
            if (lastHit) {
                lastHit.item.strokeColor = 'black';
            }
            if (hit) {
                hit.item.strokeColor = 'green';
            }
            lastHit = hit;
        },
        'onMouseDown': function(event) {
            dragging = false;
            if (handles.visible) {
                mode = handles.getMode(event.point);
                if (mode) {
                    return;
                }
            }
            if (lastHit) {
                selectItem(lastHit.item);
                mode = 'dragShape';
            } else {
                mode = 'pan';
            }
        },
        'onMouseUp': function(event) {
            if (!dragging && !lastHit) {
                selectItem(null);
            }
            mode = null;
        }
    });

    var zoom = function(level, x, y, delta) {
        if (!level && delta < 0) {
            level = paper.view.zoom * 1.1;
        } else if (!level && delta > 0) {
            level = paper.view.zoom / 1.1;
        }
        if (level) {
            // get coordinates under mouse before and after zoom...
            var before = paper.view.viewToProject(x, y);
            paper.view.zoom = level;
            // ...then scroll to keep the same point under the mouse
            moveAndCheckBounds(paper.view.viewToProject(x, y).subtract(before));
            paper.view.draw();
            $("#zoom-tool").val(parseInt(level * 100, 10));
        }
    };


    // hook up event handlers

    paper.view.element.addEventListener('mousewheel', function(ev) {
        zoom(undefined, ev.pageX, ev.pageY, -ev.wheelDelta);
    }, false);
    paper.view.element.addEventListener('DOMMouseScroll', function(ev) {
        zoom(undefined, ev.pageX, ev.pageY, ev.detail);
    }, false);

    $("#toggle-rois").click(function() {
        roiGroup.visible = !roiGroup.visible;
        selectItem(null);
        paper.view.draw(); // draw immediately
    });

    $("#panning-tool").click(function() {
        defaultTool.activate();
    });
    defaultTool.activate();

    $("#zoom-tool").on('change', function(event) {
        zoom(parseFloat(this.value, 10) / 100);
    });
};
