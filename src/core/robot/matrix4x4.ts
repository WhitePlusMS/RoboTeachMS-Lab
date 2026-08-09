export class Matrix4x4 {
  readonly data: number[][]

  constructor(values?: number[][]) {
    this.data = values ?? [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]
  }

  static identity(): Matrix4x4 {
    return new Matrix4x4()
  }

  multiply(other: Matrix4x4): Matrix4x4 {
    const result = Array.from({ length: 4 }, () => Array<number>(4).fill(0))
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        for (let index = 0; index < 4; index += 1) {
          result[row][column] += this.data[row][index] * other.data[index][column]
        }
      }
    }
    return new Matrix4x4(result)
  }

  getPosition(): [number, number, number] {
    return [this.data[0][3], this.data[1][3], this.data[2][3]]
  }

  getRotation(): number[][] {
    return this.data.slice(0, 3).map((row) => row.slice(0, 3))
  }

  static mat3Vec3Mul(matrix: number[][], vector: number[]): number[] {
    return [
      matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
      matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
      matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
    ]
  }
}

export function eulerZYXToMatrix(euler: [number, number, number]): number[][] {
  const [rx, ry, rz] = euler
  const crx = Math.cos(rx)
  const srx = Math.sin(rx)
  const cry = Math.cos(ry)
  const sry = Math.sin(ry)
  const crz = Math.cos(rz)
  const srz = Math.sin(rz)

  return [
    [cry * crz, crz * sry * srx - srz * crx, crz * sry * crx + srz * srx],
    [cry * srz, srz * sry * srx + crz * crx, srz * sry * crx - crz * srx],
    [-sry, cry * srx, cry * crx],
  ]
}
