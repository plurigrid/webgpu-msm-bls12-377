import assert from 'assert'
import mustache from 'mustache'
import { ExtPointType } from "@noble/curves/abstract/edwards";
import { BigIntPoint } from "../reference/types"
import { FieldMath } from "../reference/utils/FieldMath";
import { createHash } from 'crypto'
import {
    gen_p_limbs,
    from_words_le,
    u8s_to_points,
    compute_misc_params,
    points_to_u8s_for_gpu,
    numbers_to_u8s_for_gpu,
} from './utils'
import {
    create_sb,
    get_device,
    read_from_gpu,
    create_bind_group,
    create_and_write_sb,
    create_compute_pipeline,
    create_bind_group_layout,
} from './gpu'
import structs from './wgsl/struct/structs.template.wgsl'
import bigint_funcs from './wgsl/bigint/bigint.template.wgsl'
import field_funcs from './wgsl/field/field.template.wgsl'
import ec_funcs from './wgsl/curve/ec.template.wgsl'
import curve_parameters from './wgsl/curve/parameters.template.wgsl'
import montgomery_product_funcs from './wgsl/montgomery/mont_pro_product.template.wgsl'
import scalar_mul_shader from './wgsl/scalar_mul.template.wgsl'

const fieldMath = new FieldMath();

const ZERO_POINT = fieldMath.createPoint(
    BigInt(0), BigInt(1), BigInt(0), BigInt(1),
)

const p = BigInt('8444461749428370424248824938781546531375899335154063827935233455917409239041')
const word_size = 13

/*
 * This benchmark measures the time taken to multiply each point in an array
 * with a random 16-bit scalar.
 */
export const scalar_mul_benchmarks = async (
    baseAffinePoints: BigIntPoint[],
    bigint_scalars: bigint[]
): Promise<{x: bigint, y: bigint}> => {
    const cost = 4

    const num_scalars = 256
    const scalars: number[] = []

    // Use a PRNG instead of system randomness so that the inputs are
    // deterministic
    const hasher = createHash('sha256')
    for (let i = 0; i < num_scalars; i ++) {
        hasher.update(new Uint8Array([i]))
        const d = Array.from(hasher.digest())
        const s = new Uint16Array(d.slice(0, 4))
        const u32 = from_words_le(s, 4, 8)
        scalars.push(Number(u32))
    }

    // Convert baseAffinePoints to ETE points
    const points = baseAffinePoints.slice(0, num_scalars).map((x) => {
        return fieldMath.createPoint(
            x.x,
            x.y,
            fieldMath.Fp.mul(x.x, x.y),
            BigInt(1),
        )
    })

    // Benchmark in CPU
    const expected = cpu_benchmark(points, scalars, cost)

    // Double-and-add method in TS
    const double_and_add_cpu_results = double_and_add_cpu(points, scalars, cost)

    assert(are_point_arr_equal(double_and_add_cpu_results, expected))

    // Double-and-add method in GPU
    let start = Date.now()
    const double_and_add_gpu_results = await double_and_add_gpu(points, scalars, cost)
    let elapsed = Date.now() - start
    console.log(`double-and-add (cost = ${cost}) in GPU (including data transfer) took ${elapsed}ms`)

    assert(are_point_arr_equal(double_and_add_gpu_results, double_and_add_cpu_results))

    // Sliding window method in TS and GPU
    // NAF method in TS and GPU
    // wNAF method in TS and GPU
    // Booth encoding method in TS and GPU
    start = 0
    elapsed = 0
    /*
    */

    return { x: BigInt(1), y: BigInt(0) }
}

const copyPoint = (point: ExtPointType): ExtPointType => {
    return fieldMath.createPoint(
        BigInt(point.ex),
        BigInt(point.ey),
        BigInt(point.et),
        BigInt(point.ez),
    )
}

const cpu_benchmark = (
    points: ExtPointType[],
    scalars: number[],
    cost: number,
): ExtPointType[] => {
    const results: ExtPointType[] = []

    for (let i = 0; i < scalars.length; i ++) {
        let result = copyPoint(points[i])
        for (let j = 0; j < cost; j ++) {
            result = result.multiply(BigInt(scalars[i]))
        }
        results.push(result)
    }

    return results
} 

const double_and_add = (
    point: ExtPointType,
    scalar: number,
): ExtPointType => {
    let result = ZERO_POINT
    let temp = fieldMath.createPoint(point.ex, point.ey, point.et, point.ez)

    let scalar_iter = scalar
    while (scalar_iter !== 0) {
        if ((scalar_iter & 1) === 1) {
            result = result.add(temp)
        }
        temp = temp.double()
        scalar_iter = Number(BigInt(scalar_iter) >> BigInt(1))
    }
    return result
}

const double_and_add_cpu = (
    points: ExtPointType[],
    scalars: number[],
    cost: number,
): ExtPointType[] => {

    const results: ExtPointType[] = []

    for (let i = 0; i < scalars.length; i ++) {
        let result = copyPoint(points[i])
        for (let j = 0; j < cost; j ++) {
            result = double_and_add(result, scalars[i])
        }
        results.push(result)
    }

    return results
}

const double_and_add_gpu = async(
    points: ExtPointType[],
    scalars: number[],
    cost: number,
): Promise<ExtPointType[]> => {
    const params = compute_misc_params(p, word_size)
    const n0 = params.n0
    const num_words = params.num_words
    const r = params.r
    const rinv = params.rinv

    const input_size = scalars.length
    const workgroup_size = 1
    const num_x_workgroups = 256
    const num_y_workgroups = Math.ceil(input_size / workgroup_size / num_x_workgroups)

    const mont_points: BigIntPoint[] = []
    for (const pt of points) {
        mont_points.push({
            x: fieldMath.Fp.mul(pt.ex, r),
            y: fieldMath.Fp.mul(pt.ey, r),
            t: fieldMath.Fp.mul(pt.et, r),
            z: fieldMath.Fp.mul(pt.ez, r),
        })
    }

    // Convert points to Montgomery form
    const points_bytes = points_to_u8s_for_gpu(mont_points, num_words, word_size)
    const scalars_bytes = numbers_to_u8s_for_gpu(scalars)

    const device = await get_device()
    const commandEncoder = device.createCommandEncoder()

    const scalars_sb = create_and_write_sb(device, scalars_bytes)
    const points_sb = create_and_write_sb(device, points_bytes)
    const results_sb = create_sb(device, points_sb.size)
    
    const bindGroupLayout = create_bind_group_layout(
        device,
        [
            'read-only-storage',
            'read-only-storage',
            'storage',
        ],
    )
    const bindGroup = create_bind_group(
        device,
        bindGroupLayout,
        [ points_sb, scalars_sb, results_sb ],
    )

    const p_limbs = gen_p_limbs(p, num_words, word_size)
    const shaderCode = mustache.render(
        scalar_mul_shader,
        {
            word_size,
            num_words,
            n0,
            p_limbs,
            mask: BigInt(2) ** BigInt(word_size) - BigInt(1),
            two_pow_word_size: BigInt(2) ** BigInt(word_size),
            workgroup_size,
            num_y_workgroups,
            cost,
        },
        {
            structs,
            bigint_funcs,
            field_funcs,
            ec_funcs,
            curve_parameters,
            montgomery_product_funcs,
        },
    )
    const computePipeline = await create_compute_pipeline(
        device,
        [bindGroupLayout],
        shaderCode,
        'double_and_add_benchmark',
    )

    const passEncoder = commandEncoder.beginComputePass()
    passEncoder.setPipeline(computePipeline)
    passEncoder.setBindGroup(0, bindGroup)
    passEncoder.dispatchWorkgroups(num_x_workgroups, num_y_workgroups, 1)
    passEncoder.end()

    const results_data = await read_from_gpu(
        device,
        commandEncoder,
        [results_sb],
    )

    const d = u8s_to_points(results_data[0], num_words, word_size)
    const results_points = []
    for (const p of d) {
        const pt = fieldMath.createPoint(
            fieldMath.Fp.mul(p.x, rinv),
            fieldMath.Fp.mul(p.y, rinv),
            fieldMath.Fp.mul(p.t, rinv),
            fieldMath.Fp.mul(p.z, rinv),
        )
        results_points.push(pt)
    }

    device.destroy()

    return results_points
}

const are_point_arr_equal = (
    a: ExtPointType[],
    b: ExtPointType[],
): boolean => {
    if (a.length !== b.length) {
        return false
    }

    let result = true

    for (let i = 0; i < a.length; i ++) {
        const aa = a[i].toAffine()
        const ba = b[i].toAffine()
        result = result
            && aa.x === ba.x 
            && aa.y === ba.y
    }

    return result
}
