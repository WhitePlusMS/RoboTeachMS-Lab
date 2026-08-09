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
}
