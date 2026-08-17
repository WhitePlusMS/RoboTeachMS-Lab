import * as THREE from 'three'

interface AxesConfig {
  length: number
  radius: number
  headRadius: number
  headHeight: number
  originRadius: number
}

const BASE_AXES_CONFIG: AxesConfig = {
  length: 1,
  radius: 0.012,
  headRadius: 0.035,
  headHeight: 0.09,
  originRadius: 0.035,
}

const TOOL_AXES_CONFIG: AxesConfig = {
  length: 0.25,
  radius: 0.012,
  headRadius: 0.035,
  headHeight: 0.09,
  originRadius: 0.035,
}

/** 创建带箭头的 X/Y/Z 坐标轴，颜色遵循 X 红、Y 绿、Z 蓝约定。 */
function createAxes(name: string, config: AxesConfig): THREE.Group {
  const group = new THREE.Group()
  group.name = name
  group.renderOrder = 1000

  const up = new THREE.Vector3(0, 1, 0)
  const axes = [
    { direction: new THREE.Vector3(1, 0, 0), color: 0xff0000 },
    { direction: new THREE.Vector3(0, 1, 0), color: 0x00ff00 },
    { direction: new THREE.Vector3(0, 0, 1), color: 0x0000ff },
  ]

  axes.forEach(({ direction, color }) => {
    const axisGroup = new THREE.Group()
    const material = new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false })

    const shaftGeometry = new THREE.CylinderGeometry(
      config.radius,
      config.radius,
      config.length,
      16,
    )
    shaftGeometry.translate(0, config.length / 2, 0)
    axisGroup.add(new THREE.Mesh(shaftGeometry, material))

    const headGeometry = new THREE.ConeGeometry(config.headRadius, config.headHeight, 16)
    headGeometry.translate(0, config.length + config.headHeight / 2, 0)
    axisGroup.add(new THREE.Mesh(headGeometry, material))

    axisGroup.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction))
    group.add(axisGroup)
  })

  const originMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    depthTest: false,
    toneMapped: false,
  })
  group.add(new THREE.Mesh(new THREE.SphereGeometry(config.originRadius, 16, 16), originMaterial))

  return group
}

export function createBaseAxes(): THREE.Group {
  return createAxes('BaseAxesHelper', BASE_AXES_CONFIG)
}

export function createToolAxes(): THREE.Group {
  return createAxes('ToolAxesHelper', TOOL_AXES_CONFIG)
}

/** 领域层给出的活动 Tool/WObj 坐标显示框；与工具轴同尺寸，供选中时指示对应坐标系。 */
export function createFrameAxes(name: string): THREE.Group {
  return createAxes(name, TOOL_AXES_CONFIG)
}
